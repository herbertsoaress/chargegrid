"""Energy Autopilot: agendamento de recarga por modo (extensao aprovada, fora do playbook e da
proposta original -- ver docs/ENERGY_AUTOPILOT.md e app/services/scheduler.py).
"""

from datetime import datetime, timedelta

import pytest

from app.config import settings
from app.models import Charger, ChargingSession, SessionMode, User
from app.services import scheduler


def _session(db, *, mode, departure_time, target_pct, current_pct, started_at, max_power_kw=22.0):
    charger = db.query(Charger).first()
    if max_power_kw != charger.max_power_kw:
        charger.max_power_kw = max_power_kw
    user = db.query(User).first()
    session = ChargingSession(
        user_id=user.id,
        charger_id=charger.id,
        mode=mode,
        departure_time=departure_time,
        target_pct=target_pct,
        current_pct=current_pct,
        charging_started_at=started_at,
        payment_confirmed=True,
        rfid_ok=True,
        cable_connected=True,
    )
    db.add(session)
    db.flush()
    return session


# 14:00 em Sao Paulo (UTC-3) = 17:00 UTC. O exemplo da proposta: chegada 14h, bateria 32%, meta 85%.
ARRIVAL_UTC = datetime(2026, 9, 21, 17, 0, 0)


@pytest.fixture(autouse=True)
def _speedup_off(monkeypatch):
    """Estes testes controlam o relogio local diretamente; o teste de virtual_now cobre a aceleracao."""
    monkeypatch.setattr(settings, "ocpp_simulator_speedup", 1.0)


def test_no_plan_for_rapido_mode(db_factory):
    db = db_factory()
    session = _session(db, mode=SessionMode.rapido, departure_time="18:30", target_pct=85, current_pct=32, started_at=ARRIVAL_UTC)
    assert scheduler.build_plan(session, db, real_now=ARRIVAL_UTC) is None


def test_no_plan_without_departure_time(db_factory):
    db = db_factory()
    session = _session(db, mode=SessionMode.garantido, departure_time=None, target_pct=85, current_pct=32, started_at=ARRIVAL_UTC)
    assert scheduler.build_plan(session, db, real_now=ARRIVAL_UTC) is None


def test_no_plan_when_already_near_target(db_factory):
    db = db_factory()
    session = _session(db, mode=SessionMode.garantido, departure_time="18:30", target_pct=32, current_pct=32, started_at=ARRIVAL_UTC)
    assert scheduler.build_plan(session, db, real_now=ARRIVAL_UTC) is None


def _mock_curves(monkeypatch, occ_by_hour: dict[int, float], solar_by_hour: dict[int, float] | None = None):
    monkeypatch.setattr(scheduler.forecast, "occupancy", lambda params, weekday, hour: occ_by_hour.get(int(hour), 0.5))
    monkeypatch.setattr(scheduler.forecast, "live_occupancy", lambda db: 0.0)
    monkeypatch.setattr(scheduler.solar, "solar_kw", lambda hour: (solar_by_hour or {}).get(int(hour), 0.0))


def test_garantido_avoids_the_predicted_peak_when_there_is_slack(db_factory, monkeypatch):
    """Exemplo da proposta: chegada 14h, 32% -> 85% ate as 18h30. 16h-17h e pico previsto
    (saturado); ha horario de sobra fora do pico, entao o Garantido evita o pico por completo."""
    _mock_curves(monkeypatch, {14: 0.3, 15: 0.5, 16: 0.95, 17: 0.4, 18: 0.35})
    db = db_factory()
    session = _session(db, mode=SessionMode.garantido, departure_time="18:30", target_pct=85, current_pct=32, started_at=ARRIVAL_UTC)

    plan = scheduler.build_plan(session, db, real_now=ARRIVAL_UTC)
    assert plan is not None
    assert plan.on_track is True
    assert plan.peak_avoided is True  # o bloco das 16h (saturado) nao precisou ser usado
    assert not any(b.charging for b in plan.blocks if b.hour == 16.0)
    assert plan.energy_needed_kwh == pytest.approx((85 - 32) / 100 * 60, abs=0.01)
    # potencia do plano e a do MODO garantido (22 kW x 0,85 = 18,7 kW): 7 blocos de 15 min
    # (4,675 kWh cada) cobrem os ~31,8 kWh necessarios
    assert sum(1 for b in plan.blocks if b.charging) == 7
    # terminaria as 15h45 se fosse so isso; ate as 18h30 sobram 2h45, menos 10 min de carencia = 155 min
    assert plan.idle_savings_rs == pytest.approx(155 * settings.idle_rate_per_minute, abs=0.01)


def test_economico_never_uses_a_saturated_block_even_if_it_misses_the_target(db_factory, monkeypatch):
    """Sem a 'rede de seguranca' do Garantido: se os blocos baratos nao bastam, o Economico
    fica so com o que tem e avisa honestamente que nao vai bater a meta."""
    _mock_curves(monkeypatch, {14: 0.3, 15: 0.95})  # so 2h ate a saida: 4 blocos baratos + 4 no pico
    db = db_factory()
    session = _session(db, mode=SessionMode.economico, departure_time="16:00", target_pct=85, current_pct=32, started_at=ARRIVAL_UTC)

    plan = scheduler.build_plan(session, db, real_now=ARRIVAL_UTC)
    assert plan is not None
    assert plan.on_track is False
    assert plan.peak_avoided is True
    assert sum(1 for b in plan.blocks if b.charging) == 4  # so os 4 blocos das 14h (nao saturados)
    assert not any(b.charging for b in plan.blocks if b.saturated)


def test_garantido_uses_the_safety_net_to_still_make_the_deadline(db_factory, monkeypatch):
    """Mesmo cenario do teste anterior, mas em modo Garantido: usa parte do pico para nao
    perder a meta, mesmo que isso va contra a preferencia de preco."""
    _mock_curves(monkeypatch, {14: 0.3, 15: 0.95})
    db = db_factory()
    session = _session(db, mode=SessionMode.garantido, departure_time="16:00", target_pct=85, current_pct=32, started_at=ARRIVAL_UTC)

    plan = scheduler.build_plan(session, db, real_now=ARRIVAL_UTC)
    assert plan is not None
    assert plan.on_track is True
    assert sum(1 for b in plan.blocks if b.charging) == 7
    used_peak = [b for b in plan.blocks if b.saturated and b.charging]
    assert len(used_peak) == 3  # precisou de 3 dos 4 blocos de pico para fechar a conta
    assert all(b.reason == "meta_em_risco" for b in used_peak)
    assert plan.peak_avoided is True  # ainda evitou o outro bloco de pico


def test_sustentavel_prefers_solar_over_price(db_factory, monkeypatch):
    """As 15h/16h sao mais caras que as 14h, mas tem sol -- o Sustentavel carrega as 15h/16h.
    Potencia do modo (22 kW x 0,75 = 16,5 kW -> 4,125 kWh/bloco); meta de 16,8 kWh precisa de
    5 blocos, que cabem nas duas horas de sol (8 blocos disponiveis)."""
    _mock_curves(monkeypatch, {14: 0.3, 15: 0.5, 16: 0.4}, {14: 0.0, 15: 10.0, 16: 10.0})
    db = db_factory()
    session = _session(db, mode=SessionMode.sustentavel, departure_time="17:00", target_pct=60, current_pct=32, started_at=ARRIVAL_UTC)

    plan = scheduler.build_plan(session, db, real_now=ARRIVAL_UTC)
    assert plan is not None
    chosen_hours = {int(b.hour) for b in plan.blocks if b.charging}  # so dentro das horas de sol
    assert chosen_hours == {15, 16}
    assert sum(1 for b in plan.blocks if b.charging) == 5
    assert all(b.reason == "solar" for b in plan.blocks if b.charging)
    assert plan.solar_kwh == pytest.approx(5 * 4.125, abs=0.01)


def test_current_power_kw_follows_the_plan_and_falls_back_without_one(db_factory, monkeypatch):
    _mock_curves(monkeypatch, {14: 0.3, 15: 0.95, 16: 0.3, 17: 0.3, 18: 0.3})
    db = db_factory()
    session = _session(db, mode=SessionMode.garantido, departure_time="18:30", target_pct=85, current_pct=32, started_at=ARRIVAL_UTC)
    plan = scheduler.build_plan(session, db, real_now=ARRIVAL_UTC)
    assert plan is not None

    now_in_first_block = ARRIVAL_UTC + timedelta(minutes=5)
    assert scheduler.current_power_kw(plan, now_in_first_block, session) in (0.0, plan.max_power_kw)

    # sem plano (modo rapido): quem chama deve usar a potencia nominal do modo, nao 0 nem trava
    assert scheduler.current_power_kw(None, ARRIVAL_UTC, session) is None


def test_virtual_now_runs_speedup_times_faster_than_real_clock(db_factory, monkeypatch):
    monkeypatch.setattr(settings, "ocpp_simulator_speedup", 60.0)
    db = db_factory()
    session = _session(db, mode=SessionMode.garantido, departure_time="18:30", target_pct=85, current_pct=32, started_at=ARRIVAL_UTC)
    one_real_minute_later = ARRIVAL_UTC + timedelta(minutes=1)
    virtual = scheduler.virtual_now(session, one_real_minute_later)
    assert virtual == ARRIVAL_UTC + timedelta(hours=1)  # 1 min real x 60 = 1h "de plano"


# ---------------- integracao com a tarifacao por tempo (services/pricing.py) ----------------
def test_scheduled_session_bills_time_using_the_accelerated_plan_clock(client, db_factory, driver_headers):
    """Sessao com horario de saida (Energy Autopilot) cobra o tempo pelo RELOGIO DO PLANO
    (acelerado por OCPP_SIMULATOR_SPEEDUP), nao pela conta energia/potencia usada pelo Rapido."""
    from tests.conftest import free_charger_id, start_charging

    sid = start_charging(
        client, driver_headers, free_charger_id(client, driver_headers),
        mode="garantido", departure_time="23:59", target_pct=90,
    )["id"]
    client.post(f"/sessions/{sid}/meter-values", json={"energy_kwh": 3.0, "power_kw": 18.7}, headers=driver_headers)

    db = db_factory()
    row = db.get(ChargingSession, sid)
    row.charging_started_at -= timedelta(minutes=2)  # simula 2 min reais passados desde a energia liberada
    db.commit()
    db.close()

    session = client.get(f"/sessions/{sid}", headers=driver_headers).json()
    expected_minutes = 2 * settings.ocpp_simulator_speedup
    assert session["minutes_charging"] == pytest.approx(expected_minutes, abs=0.5)
    # nao e a conta antiga (energia/potencia), que daria um numero bem menor aqui
    naive_minutes = round(3.0 / (22 * 0.85) * 60, 2)
    assert session["minutes_charging"] != pytest.approx(naive_minutes, abs=0.5)


# ---------------- endpoint GET /sessions/{id}/schedule ----------------
def test_schedule_endpoint_has_no_plan_for_rapido(client, driver_headers):
    from tests.conftest import free_charger_id, start_charging

    sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers), mode="rapido")["id"]
    schedule = client.get(f"/sessions/{sid}/schedule", headers=driver_headers).json()
    assert schedule == {
        "has_plan": False, "departure": None, "energy_needed_kwh": None, "max_power_kw": None,
        "on_track": None, "peak_avoided": None, "solar_kwh": None, "idle_savings_rs": None, "blocks": [],
    }


def test_schedule_endpoint_returns_a_plan_for_garantido_with_departure(client, driver_headers):
    from tests.conftest import free_charger_id, start_charging

    sid = start_charging(
        client, driver_headers, free_charger_id(client, driver_headers),
        mode="garantido", departure_time="23:59", target_pct=90,
    )["id"]
    schedule = client.get(f"/sessions/{sid}/schedule", headers=driver_headers).json()
    assert schedule["has_plan"] is True
    assert schedule["max_power_kw"] == 18.7  # 22 kW x 0,85 (potencia do modo garantido, nao a crua do carregador)
    assert schedule["energy_needed_kwh"] > 0
    assert isinstance(schedule["on_track"], bool)
    assert len(schedule["blocks"]) > 0
    assert {"start", "hour", "occupancy", "solar_kw", "saturated", "charging", "reason"} <= schedule["blocks"][0].keys()


def test_schedule_endpoint_requires_login_and_ownership(client, driver_headers, operator_headers):
    from tests.conftest import free_charger_id, start_charging

    sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers))["id"]
    assert client.get(f"/sessions/{sid}/schedule").status_code == 401
    assert client.get(f"/sessions/{sid}/schedule", headers=operator_headers).status_code == 200  # operador ve qualquer sessao

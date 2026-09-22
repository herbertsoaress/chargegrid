"""Tarifacao por tempo de uso e por potencia (extensao aprovada, fora do playbook e da proposta
original -- ver docs/ETAPA_5_PROPOSTA.md). Complementa test_forecast_pricing.py (preco do kWh) e
test_payments.py (acerto do valor final): aqui o foco e o acrescimo por modo, a tarifa por minuto
de recarga, a taxa de ociosidade (depois da bateria cheia) e o teto por kWh entregue.
"""

from datetime import timedelta

import pytest

from app.config import settings
from app.models import ChargingSession, SessionMode
from app.services.pricing import mode_surcharge_per_kwh
from app.timeutil import utcnow
from tests.conftest import expected_amount, free_charger_id, start_charging


def test_faster_modes_cost_more_per_kwh_and_take_less_time(client, driver_headers):
    """Rapido: mais caro por kWh e mais rapido. Economico: mais barato e mais lento. O tempo
    estimado usa energia/potencia (nao o relogio de parede), a mesma conta que a tela do app."""
    results = {}
    for mode in ("economico", "sustentavel", "garantido", "rapido"):
        sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers), mode=mode)["id"]
        client.post(f"/sessions/{sid}/meter-values", json={"energy_kwh": 11.0, "power_kw": 10.0}, headers=driver_headers)
        session = client.get(f"/sessions/{sid}", headers=driver_headers).json()
        results[mode] = session

    # potencia maior = tempo menor para a mesma energia (11 kWh)
    assert results["rapido"]["minutes_charging"] < results["garantido"]["minutes_charging"]
    assert results["garantido"]["minutes_charging"] < results["sustentavel"]["minutes_charging"]
    assert results["sustentavel"]["minutes_charging"] < results["economico"]["minutes_charging"]

    # cada sessao trava o preco do modelo no proprio instante (a carga da rede sobe a cada sessao
    # aberta), entao a conferencia usa o preco QUE ELA MESMA travou + o acrescimo do proprio modo
    for mode, session in results.items():
        surcharge = mode_surcharge_per_kwh(SessionMode(mode))
        expected = round(session["energy_kwh"] * (session["price_per_kwh_snapshot"] + surcharge), 2)
        assert session["energy_amount"] == expected
    assert mode_surcharge_per_kwh(SessionMode.economico) == 0.0  # economico: sem acrescimo
    assert results["economico"]["energy_amount"] == round(11.0 * results["economico"]["price_per_kwh_snapshot"], 2)
    assert results["rapido"]["energy_amount"] > results["garantido"]["energy_amount"] > results["sustentavel"]["energy_amount"]


def test_amount_due_equals_energy_plus_time_components(client, driver_headers):
    sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers), mode="garantido")["id"]
    client.post(f"/sessions/{sid}/meter-values", json={"energy_kwh": 6.5, "power_kw": 18.7}, headers=driver_headers)
    session = client.get(f"/sessions/{sid}", headers=driver_headers).json()
    assert session["idle_amount"] == 0.0  # bateria ainda nao encheu
    assert session["amount_estimate"] == round(session["energy_amount"] + session["time_amount"], 2)
    assert session["amount_estimate"] == expected_amount(6.5, session["price_per_kwh_snapshot"], mode="garantido")

    paid = client.post(f"/sessions/{sid}/pay", json={"method": "pix"}, headers=driver_headers).json()
    assert paid["amount"] == session["amount_estimate"]


def test_idle_time_is_only_charged_after_the_grace_period(client, db_factory, driver_headers):
    """A bateria enche (SoC 100 via medidor) e o motorista demora a buscar o carro: os primeiros
    IDLE_GRACE_MINUTES nao custam nada; depois disso, cada minuto parado soma a taxa de ociosidade."""
    sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers))["id"]
    client.post(
        f"/sessions/{sid}/meter-values",
        json={"energy_kwh": 10.0, "power_kw": 22.0, "soc_pct": 100.0},
        headers=driver_headers,
    )
    session = client.get(f"/sessions/{sid}", headers=driver_headers).json()
    assert session["current_pct"] == 100.0

    db = db_factory()
    row = db.get(ChargingSession, sid)
    assert row.full_at is not None, "a bateria cheia deveria ter marcado full_at"
    row.full_at -= timedelta(minutes=3)  # dentro da carencia (10 min): ainda nao deve cobrar
    db.commit()
    db.close()
    within_grace = client.get(f"/sessions/{sid}", headers=driver_headers).json()
    assert within_grace["idle_amount"] == 0.0
    assert within_grace["minutes_idle"] == 0.0

    db = db_factory()
    row = db.get(ChargingSession, sid)
    row.full_at -= timedelta(minutes=25)  # agora ha ~28 min desde full_at: 18 min faturaveis
    db.commit()
    db.close()
    after_grace = client.get(f"/sessions/{sid}", headers=driver_headers).json()
    assert after_grace["minutes_idle"] > 10  # 28 - 10 de carencia, com folga para o tempo do teste
    assert after_grace["idle_amount"] == pytest.approx(after_grace["minutes_idle"] * settings.idle_rate_per_minute, abs=0.01)

    paid = client.post(f"/sessions/{sid}/pay", json={"method": "pix"}, headers=driver_headers).json()
    stopped = client.post(f"/sessions/{sid}/stop", headers=driver_headers).json()
    assert stopped["idle_amount"] > 0
    assert paid["amount"] == pytest.approx(stopped["amount_due"], abs=0.02)  # pouco tempo passa entre pagar e parar
    receipt = client.get(f"/sessions/{sid}/receipt", headers=driver_headers).json()
    assert receipt["idle_amount"] == stopped["idle_amount"]
    assert receipt["amount"] == round(receipt["energy_amount"] + receipt["time_amount"] + receipt["idle_amount"], 2)


def test_price_cap_limits_a_very_idle_low_energy_session(client, db_factory, driver_headers):
    """Pouca energia entregue + muito tempo parado: sem teto, o preco medio por kWh dispararia.
    O valor final nunca passa de PRICE_CAP_PER_KWH multiplicado pela energia entregue."""
    sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers))["id"]
    client.post(
        f"/sessions/{sid}/meter-values",
        json={"energy_kwh": 1.0, "power_kw": 22.0, "soc_pct": 100.0},
        headers=driver_headers,
    )
    db = db_factory()
    row = db.get(ChargingSession, sid)
    row.full_at -= timedelta(minutes=60)  # ~50 min faturaveis de ociosidade sobre so 1 kWh entregue
    db.commit()
    db.close()

    session = client.get(f"/sessions/{sid}", headers=driver_headers).json()
    uncapped = round(session["energy_amount"] + session["time_amount"] + session["idle_amount"], 2)
    cap_total = round(1.0 * settings.price_cap_per_kwh, 2)
    assert uncapped > cap_total  # confirma que o cenario realmente estouraria o teto
    assert session["price_capped"] is True
    assert session["amount_estimate"] == cap_total

    paid = client.post(f"/sessions/{sid}/pay", json={"method": "pix"}, headers=driver_headers).json()
    assert paid["amount"] == cap_total


def test_old_sessions_without_tariff_snapshot_are_never_capped_to_zero(db_factory):
    """Sessoes de antes desta extensao tem as tarifas novas zeradas (default da coluna). O teto
    (0.0) precisa ser tratado como "sem teto" nelas, nunca como "capado em R$ 0"."""
    from app.models import Charger, User
    from app.services import pricing

    db = db_factory()
    charger = db.query(Charger).first()
    user = db.query(User).first()
    session = ChargingSession(
        user_id=user.id,
        charger_id=charger.id,
        energy_kwh=5.0,
        price_per_kwh_snapshot=1.5,
        # mode_surcharge_snapshot / time_rate_snapshot / idle_rate_snapshot / price_cap_per_kwh_snapshot:
        # todos ficam no default (0.0) da coluna, como uma sessao gravada antes desta extensao existir.
        last_meter_at=utcnow(),  # energia ja "medida" (nao recalcula pelo controlador simulado)
    )
    db.add(session)
    db.flush()

    b = pricing.breakdown(session)
    assert b.capped is False
    assert b.total == round(5.0 * 1.5, 2)
    db.close()

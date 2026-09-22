"""Pontuacao do motorista (fidelidade): extensao aprovada, so visual (sem desconto real), fora do
playbook e da proposta original -- ver docs/ETAPA_5_PROPOSTA.md e app/services/loyalty.py.
"""

from datetime import timedelta

from app.models import ChargingSession
from app.services import loyalty
from app.timeutil import utcnow
from tests.conftest import free_charger_id, start_charging


def _finish_a_session(client, headers, energy_kwh: float = 1.0) -> int:
    sid = start_charging(client, headers, free_charger_id(client, headers))["id"]
    client.post(f"/sessions/{sid}/meter-values", json={"energy_kwh": energy_kwh, "power_kw": 22.0}, headers=headers)
    client.post(f"/sessions/{sid}/pay", json={"method": "pix"}, headers=headers)
    client.post(f"/sessions/{sid}/stop", headers=headers)
    return sid


def test_loyalty_requires_login_and_is_driver_only(client, operator_headers):
    assert client.get("/users/me/loyalty").status_code == 401
    assert client.get("/users/me/loyalty", headers=operator_headers).status_code == 403


def test_new_driver_starts_at_zero_bronze(client, driver_headers):
    status = client.get("/users/me/loyalty", headers=driver_headers).json()
    assert status == {
        "points": 0,
        "tier": "Bronze",
        "next_tier": "Prata",
        "points_to_next_tier": 500,
        "week_sessions": 0,
        "week_goal": 3,
        "week_goal_met": False,
        "weeks_goal_met": 0,
        "points_per_kwh": 10,
        "weekly_goal_bonus": 50,
    }


def test_points_come_from_kwh_of_ended_sessions_only(client, driver_headers):
    sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers))["id"]
    client.post(f"/sessions/{sid}/meter-values", json={"energy_kwh": 12.0, "power_kw": 22.0}, headers=driver_headers)
    # sessao ainda ABERTA: nao pontua
    assert client.get("/users/me/loyalty", headers=driver_headers).json()["points"] == 0

    client.post(f"/sessions/{sid}/pay", json={"method": "pix"}, headers=driver_headers)
    client.post(f"/sessions/{sid}/stop", headers=driver_headers)
    status = client.get("/users/me/loyalty", headers=driver_headers).json()
    assert status["points"] == 120  # 12 kWh x 10 pontos
    assert status["week_sessions"] == 1
    assert status["week_goal_met"] is False


def test_weekly_goal_gives_a_bonus_and_resets_the_following_week(client, db_factory, driver_headers):
    for _ in range(3):
        _finish_a_session(client, driver_headers, energy_kwh=1.0)
    status = client.get("/users/me/loyalty", headers=driver_headers).json()
    assert status["week_sessions"] == 3
    assert status["week_goal_met"] is True
    assert status["weeks_goal_met"] == 1
    assert status["points"] == 3 * 10 + 50  # 3 kWh de pontos + o bonus da semana

    # joga as 3 sessoes para a semana passada: a meta da semana ATUAL volta a zero, mas o bonus
    # ja ganho continua contando no total (pontos nunca "voltam atras")
    db = db_factory()
    for row in db.query(ChargingSession).filter(ChargingSession.ended_at.isnot(None)):
        row.ended_at -= timedelta(days=8)
    db.commit()
    db.close()
    after = client.get("/users/me/loyalty", headers=driver_headers).json()
    assert after["week_sessions"] == 0
    assert after["week_goal_met"] is False
    assert after["weeks_goal_met"] == 1
    assert after["points"] == status["points"]


def test_tier_thresholds_and_progress_to_next_tier(db_factory):
    silver = loyalty._tier_for(500)
    assert silver == ("Prata", "Ouro", 1500)
    gold = loyalty._tier_for(2500)
    assert gold == ("Ouro", None, None)
    bronze_edge = loyalty._tier_for(499)
    assert bronze_edge == ("Bronze", "Prata", 1)


def test_different_iso_weeks_do_not_share_the_weekly_goal(client, db_factory, driver_headers):
    """Duas sessoes contam para a mesma semana ISO (segunda a domingo, fuso de Brasilia); jogando
    uma delas 7 dias para tras, ela sai da semana atual -- por isso a meta e semanal, e nao
    "nos ultimos 7 dias"."""
    _finish_a_session(client, driver_headers)
    _finish_a_session(client, driver_headers)
    assert client.get("/users/me/loyalty", headers=driver_headers).json()["week_sessions"] == 2

    db = db_factory()
    sessions = db.query(ChargingSession).filter(ChargingSession.ended_at.isnot(None)).all()
    assert len(sessions) == 2
    sessions[0].ended_at -= timedelta(days=7)
    db.commit()
    db.close()

    status = client.get("/users/me/loyalty", headers=driver_headers).json()
    assert status["week_sessions"] == 1
    assert status["week_goal_met"] is False


def test_status_for_a_brand_new_driver_with_no_sessions(db_factory):
    from app.models import Role, User

    db = db_factory()
    new_driver = User(name="Teste Loyalty", email="loyalty@teste.com", password_hash="x", role=Role.driver)
    db.add(new_driver)
    db.commit()
    status = loyalty.status_for(db, new_driver.id, now=utcnow())
    db.close()
    assert status.points == 0 and status.tier == "Bronze" and status.week_sessions == 0

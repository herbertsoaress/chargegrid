import pytest

from app.config import settings
from tests.conftest import free_charger_id, login, start_charging


def test_session_routes_require_login(client):
    assert client.post("/sessions", json={"charger_id": 1}).status_code == 401
    assert client.get("/sessions/1").status_code == 401
    assert client.post("/sessions/1/pay", json={"method": "pix"}).status_code == 401


def test_signup_cannot_create_operator_even_if_role_is_sent(client):
    response = client.post(
        "/auth/signup",
        json={"name": "Invasor", "email": "invasor@example.com", "password": "senha123", "role": "operator"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "driver"


def test_operator_email_allowlist_promotes_on_signup(client, monkeypatch):
    monkeypatch.setattr(settings, "operator_emails", "chefe@example.com")
    response = client.post(
        "/auth/signup", json={"name": "Chefe", "email": "Chefe@Example.com", "password": "senha123"}
    )
    assert response.json()["role"] == "operator"


def test_duplicate_signup_is_rejected(client):
    payload = {"name": "Ana", "email": "ana@example.com", "password": "senha123"}
    assert client.post("/auth/signup", json=payload).status_code == 200
    assert client.post("/auth/signup", json=payload).status_code == 400


def test_another_driver_cannot_see_or_change_my_session(client, driver_headers):
    charger_id = free_charger_id(client, driver_headers)
    session_id = client.post("/sessions", json={"charger_id": charger_id}, headers=driver_headers).json()["id"]

    other = client.post(
        "/auth/signup", json={"name": "Outra Pessoa", "email": "outra@example.com", "password": "senha123"}
    ).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    assert client.get(f"/sessions/{session_id}", headers=other_headers).status_code == 404
    assert client.post(f"/sessions/{session_id}/confirm-payment", headers=other_headers).status_code == 404
    assert client.post(f"/sessions/{session_id}/pay", json={"method": "pix"}, headers=other_headers).status_code == 404
    assert client.get("/sessions", headers=other_headers).json() == []


def test_operator_can_see_any_session(client, driver_headers, operator_headers):
    charger_id = free_charger_id(client, driver_headers)
    session_id = client.post("/sessions", json={"charger_id": charger_id}, headers=driver_headers).json()["id"]
    assert client.get(f"/sessions/{session_id}", headers=operator_headers).status_code == 200
    assert len(client.get("/sessions", headers=operator_headers).json()) == 1


def test_demo_login_returns_token_and_can_be_disabled(client, monkeypatch):
    ok = client.post("/auth/demo-login", json={"role": "operator"})
    assert ok.status_code == 200 and ok.json()["role"] == "operator"

    monkeypatch.setattr(settings, "allow_demo_login", False)
    assert client.post("/auth/demo-login", json={"role": "driver"}).status_code == 404


def test_double_payment_is_rejected(client, driver_headers):
    session = start_charging(client, driver_headers, free_charger_id(client, driver_headers))
    assert client.post(f"/sessions/{session['id']}/pay", json={"method": "pix"}, headers=driver_headers).status_code == 200
    assert client.post(f"/sessions/{session['id']}/pay", json={"method": "cartao"}, headers=driver_headers).status_code == 409


def test_operator_only_endpoints_reject_drivers(client, driver_headers):
    for path in ["/billing/summary", "/billing/invoices", "/billing/balancing", "/events", "/goodwe/plants",
                 "/goodwe/devices", "/goodwe/logs", "/users"]:
        assert client.get(path, headers=driver_headers).status_code == 403, path
        assert client.get(path).status_code == 401, path


def test_stale_session_is_expired_when_charger_is_requested_again(client, db_factory, driver_headers, operator_headers):
    from datetime import timedelta

    from app.models import ChargingSession
    from app.timeutil import utcnow

    charger_id = free_charger_id(client, driver_headers)
    first_id = client.post("/sessions", json={"charger_id": charger_id}, headers=driver_headers).json()["id"]

    # carregador ocupado: outro pedido imediato falha
    assert client.post("/sessions", json={"charger_id": charger_id}, headers=driver_headers).status_code == 409

    # sessao "abandonada" ha 3 horas
    db = db_factory()
    db.get(ChargingSession, first_id).started_at = utcnow() - timedelta(hours=3)
    db.commit()
    db.close()

    second = client.post("/sessions", json={"charger_id": charger_id}, headers=driver_headers)
    assert second.status_code == 200, second.text
    types = [e["type"] for e in client.get(f"/sessions/{first_id}/events", headers=operator_headers).json()]
    assert "session_expired" in types


@pytest.mark.parametrize("password", ["123", "x" * 80])
def test_signup_validates_password_length(client, password):
    response = client.post("/auth/signup", json={"name": "Teste", "email": "t@example.com", "password": password})
    assert response.status_code == 422

import pytest

from app.config import settings
from app.security import LoginThrottle, login_throttle
from tests.conftest import free_charger_id, login

PASSWORD = "chargegrid123"


@pytest.fixture(autouse=True)
def _clean_throttle():
    login_throttle.reset()
    yield
    login_throttle.reset()


def signup(client, name="Ana Paula", email="ana@example.com", password="senha1234"):
    response = client.post("/auth/signup", json={"name": name, "email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json(), {"Authorization": f"Bearer {response.json()['access_token']}"}


# ---------------- login e cadastro ----------------
def test_signup_then_login_returns_a_driver_and_me_shows_profile(client):
    token, headers = signup(client)
    assert token["role"] == "driver" and token["name"] == "Ana Paula"

    again = client.post("/auth/login", json={"email": "ANA@example.com", "password": "senha1234"})
    assert again.status_code == 200 and again.json()["user_id"] == token["user_id"]  # e-mail nao diferencia maiusculas

    me = client.get("/auth/me", headers=headers).json()
    assert me["email"] == "ana@example.com" and me["role"] == "driver" and me["name"] == "Ana Paula"
    assert "password" not in str(me).lower()


def test_wrong_password_and_unknown_email_give_the_same_message(client):
    signup(client)
    wrong = client.post("/auth/login", json={"email": "ana@example.com", "password": "errada123"})
    unknown = client.post("/auth/login", json={"email": "ninguem@example.com", "password": "qualquer123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"]  # nao revela se o e-mail existe


def test_signup_validates_input(client):
    assert client.post("/auth/signup", json={"name": "A", "email": "a@example.com", "password": "senha1234"}).status_code == 422
    assert client.post("/auth/signup", json={"name": "Ana", "email": "nao-e-email", "password": "senha1234"}).status_code == 422
    assert client.post("/auth/signup", json={"name": "Ana", "email": "a@example.com", "password": "123"}).status_code == 422


# ---------------- limite de tentativas ----------------
def test_login_is_blocked_after_repeated_failures_even_with_the_right_password(client):
    signup(client)
    for _ in range(5):
        assert client.post("/auth/login", json={"email": "ana@example.com", "password": "errada123"}).status_code == 401
    blocked = client.post("/auth/login", json={"email": "ana@example.com", "password": "senha1234"})
    assert blocked.status_code == 429 and "Muitas tentativas" in blocked.json()["detail"]
    # outra conta nao e afetada
    assert client.post("/auth/login", json={"email": "motorista@chargegrid.demo", "password": PASSWORD}).status_code == 200


def test_successful_login_resets_the_failure_counter(client):
    signup(client)
    for _ in range(4):
        client.post("/auth/login", json={"email": "ana@example.com", "password": "errada123"})
    assert client.post("/auth/login", json={"email": "ana@example.com", "password": "senha1234"}).status_code == 200
    for _ in range(4):  # comeca do zero: 4 falhas de novo ainda nao bloqueiam
        assert client.post("/auth/login", json={"email": "ana@example.com", "password": "errada123"}).status_code == 401
    assert client.post("/auth/login", json={"email": "ana@example.com", "password": "senha1234"}).status_code == 200


def test_throttle_window_expires():
    throttle = LoginThrottle(max_failures=3, window_seconds=60)
    for t in (0, 1, 2):
        throttle.register_failure("k", now=t)
    assert throttle.blocked("k", now=3)
    assert not throttle.blocked("k", now=100)  # passou a janela de 60 s
    throttle.register_failure("k", now=100)
    assert not throttle.blocked("k", now=101)


# ---------------- login de demonstracao ----------------
def test_health_tells_the_app_whether_demo_login_is_on(client, monkeypatch):
    assert client.get("/health").json()["demo_login"] is True
    monkeypatch.setattr(settings, "allow_demo_login", False)
    assert client.get("/health").json()["demo_login"] is False
    assert client.post("/auth/demo-login", json={"role": "driver"}).status_code == 404


# ---------------- veiculos ----------------
def test_vehicle_plate_is_normalized_and_validated(client):
    _, headers = signup(client)
    created = client.post("/vehicles", json={"plate": "abc-1d23", "model": "BYD Dolphin"}, headers=headers)
    assert created.status_code == 200 and created.json()["plate"] == "ABC1D23"
    assert client.post("/vehicles", json={"plate": "###!!", "model": "Tesla"}, headers=headers).status_code == 422
    assert client.post("/vehicles", json={"plate": "AB", "model": "Tesla"}, headers=headers).status_code == 422
    assert client.post("/vehicles", json={"plate": "ABC1D23", "model": ""}, headers=headers).status_code == 422
    assert [v["plate"] for v in client.get("/vehicles/me", headers=headers).json()] == ["ABC1D23"]


def test_each_driver_only_sees_and_deletes_their_own_vehicles(client, driver_headers):
    _, ana = signup(client)
    vehicle = client.post("/vehicles", json={"plate": "XYZ9A88", "model": "Tesla Model 3"}, headers=ana).json()
    assert all(v["plate"] != "XYZ9A88" for v in client.get("/vehicles/me", headers=driver_headers).json())
    assert client.delete(f"/vehicles/{vehicle['id']}", headers=driver_headers).status_code == 404  # de outro usuario
    assert client.delete(f"/vehicles/{vehicle['id']}", headers=ana).status_code == 204
    assert client.get("/vehicles/me", headers=ana).json() == []
    assert client.delete(f"/vehicles/{vehicle['id']}", headers=ana).status_code == 404
    assert client.delete("/vehicles/1").status_code == 401


def test_vehicle_with_sessions_cannot_be_deleted(client):
    _, ana = signup(client)
    vehicle = client.post("/vehicles", json={"plate": "AAA1B22", "model": "GWM Ora 03"}, headers=ana).json()
    session = client.post(
        "/sessions", json={"charger_id": free_charger_id(client, ana), "mode": "rapido", "vehicle_id": vehicle["id"]}, headers=ana
    )
    assert session.status_code == 200 and session.json()["id"]
    assert client.delete(f"/vehicles/{vehicle['id']}", headers=ana).status_code == 409


def test_session_rejects_someone_elses_vehicle(client, driver_headers):
    _, ana = signup(client)
    mine = client.get("/vehicles/me", headers=driver_headers).json()[0]  # BYD do motorista demo
    hijack = client.post(
        "/sessions", json={"charger_id": free_charger_id(client, ana), "mode": "rapido", "vehicle_id": mine["id"]}, headers=ana
    )
    assert hijack.status_code == 404 and hijack.json()["detail"] == "Veiculo nao encontrado"
    own = client.post(
        "/sessions", json={"charger_id": free_charger_id(client, driver_headers), "vehicle_id": mine["id"]}, headers=driver_headers
    )
    assert own.status_code == 200


def test_operator_login_uses_the_same_endpoint(client):
    headers = login(client, "operador@chargegrid.demo")
    assert client.get("/auth/me", headers=headers).json()["role"] == "operator"

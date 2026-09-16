def _login(client, email="motorista@chargegrid.demo", password="chargegrid123"):
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth_headers(client):
    token = _login(client)
    return {"Authorization": f"Bearer {token}"}


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_goodwe_status_defaults_to_simulated(client):
    data = client.get("/goodwe/status").json()
    assert data["origem"] == "simulado"


def test_full_session_journey_updates_state_and_charger_without_manual_db_edits(client):
    headers = _auth_headers(client)

    stations = client.get("/stations", headers=headers).json()
    charger = next(c for s in stations for c in s["chargers"] if c["status"] == "livre")

    created = client.post("/sessions", json={"charger_id": charger["id"], "mode": "rapido"}, headers=headers)
    assert created.status_code == 200, created.text
    session = created.json()
    session_id = session["id"]
    assert session["status"] == "aguardando_confirmacao_pagamento"

    # nao pode encerrar antes da trava liberar
    early_stop = client.post(f"/sessions/{session_id}/stop", headers=headers)
    assert early_stop.status_code == 409

    # nao pode engatar o cabo sem pagamento + rfid confirmados antes
    early_cable = client.post(f"/sessions/{session_id}/connect-cable", headers=headers)
    assert early_cable.status_code == 409

    client.post(f"/sessions/{session_id}/confirm-payment", headers=headers)
    client.post(f"/sessions/{session_id}/authenticate-rfid", params={"approved": True}, headers=headers)
    cable = client.post(f"/sessions/{session_id}/connect-cable", headers=headers)
    assert cable.json()["status"] == "carregando"
    assert cable.json()["power_released"] is True

    payment = client.post(f"/sessions/{session_id}/pay", json={"method": "pix"}, headers=headers)
    assert payment.status_code == 200, payment.text
    assert payment.json()["status"] == "aprovado"

    final = client.get(f"/sessions/{session_id}", headers=headers).json()
    assert final["status"] == "finalizada_cabo_liberado"
    assert final["lock_released"] is True

    stop = client.post(f"/sessions/{session_id}/stop", headers=headers)
    assert stop.status_code == 200, stop.text
    assert stop.json()["ended_at"] is not None

    charger_after = client.get(f"/chargers/{charger['id']}", headers=headers).json()
    assert charger_after["status"] == "livre"

    events = client.get(f"/sessions/{session_id}/events", headers=headers).json()
    event_types = [e["type"] for e in events]
    assert event_types == [
        "session_created",
        "payment_confirmed",
        "rfid_authenticated",
        "cable_connected",
        "payment_finalized",
        "session_stopped",
    ]


def test_maintenance_bypass_requires_operator_role(client):
    driver_headers = _auth_headers(client)
    stations = client.get("/stations", headers=driver_headers).json()
    charger = next(c for s in stations for c in s["chargers"] if c["status"] == "livre")
    session_id = client.post(
        "/sessions", json={"charger_id": charger["id"], "mode": "economico"}, headers=driver_headers
    ).json()["id"]

    forbidden = client.post(f"/sessions/{session_id}/maintenance-bypass", headers=driver_headers)
    assert forbidden.status_code == 403

    operator_headers = {"Authorization": f"Bearer {_login(client, 'operador@chargegrid.demo', 'chargegrid123')}"}
    allowed = client.post(f"/sessions/{session_id}/maintenance-bypass", headers=operator_headers)
    assert allowed.status_code == 200
    assert allowed.json()["status"] == "bypass_manutencao"
    assert allowed.json()["lock_released"] is True

    # bypass ligado: pode encerrar mesmo sem RFID/cabo/pagamento
    stop = client.post(f"/sessions/{session_id}/stop", headers=driver_headers)
    assert stop.status_code == 200, stop.text

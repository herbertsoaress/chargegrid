from tests.conftest import free_charger_id, login, start_charging


def test_health_reports_database_and_goodwe_origin(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"]["ok"] is True
    assert body["goodwe"]["origem"] == "simulado"


def test_goodwe_status_defaults_to_simulated(client):
    assert client.get("/goodwe/status").json()["origem"] == "simulado"


def test_full_session_journey_updates_state_and_charger_without_manual_db_edits(client, driver_headers):
    charger_id = free_charger_id(client, driver_headers)

    created = client.post("/sessions", json={"charger_id": charger_id, "mode": "rapido"}, headers=driver_headers)
    assert created.status_code == 200, created.text
    session = created.json()
    session_id = session["id"]
    assert session["status"] == "aguardando_confirmacao_pagamento"

    # nao pode encerrar antes da trava liberar
    assert client.post(f"/sessions/{session_id}/stop", headers=driver_headers).status_code == 409
    # nao pode engatar o cabo sem pagamento + rfid confirmados antes
    assert client.post(f"/sessions/{session_id}/connect-cable", headers=driver_headers).status_code == 409

    client.post(f"/sessions/{session_id}/confirm-payment", headers=driver_headers)
    client.post(f"/sessions/{session_id}/authenticate-rfid", params={"approved": True}, headers=driver_headers)
    cable = client.post(f"/sessions/{session_id}/connect-cable", headers=driver_headers)
    assert cable.json()["status"] == "carregando"
    assert cable.json()["power_released"] is True

    payment = client.post(f"/sessions/{session_id}/pay", json={"method": "pix"}, headers=driver_headers)
    assert payment.status_code == 200, payment.text
    assert payment.json()["status"] == "aprovado"

    final = client.get(f"/sessions/{session_id}", headers=driver_headers).json()
    assert final["status"] == "finalizada_cabo_liberado"
    assert final["lock_released"] is True

    stop = client.post(f"/sessions/{session_id}/stop", headers=driver_headers)
    assert stop.status_code == 200, stop.text
    assert stop.json()["ended_at"] is not None

    assert client.get(f"/chargers/{charger_id}").json()["status"] == "livre"

    events = client.get(f"/sessions/{session_id}/events", headers=driver_headers).json()
    assert [e["type"] for e in events] == [
        "session_created",
        "payment_confirmed",
        "rfid_authenticated",
        "cable_connected",
        "payment_finalized",
        "session_stopped",
    ]


def test_maintenance_bypass_requires_operator_role(client, driver_headers, operator_headers):
    charger_id = free_charger_id(client, driver_headers)
    session_id = client.post(
        "/sessions", json={"charger_id": charger_id, "mode": "economico"}, headers=driver_headers
    ).json()["id"]

    assert client.post(f"/sessions/{session_id}/maintenance-bypass", headers=driver_headers).status_code == 403

    allowed = client.post(f"/sessions/{session_id}/maintenance-bypass", headers=operator_headers)
    assert allowed.status_code == 200
    assert allowed.json()["status"] == "bypass_manutencao"
    assert allowed.json()["lock_released"] is True

    # bypass ligado: pode encerrar mesmo sem RFID/cabo/pagamento
    assert client.post(f"/sessions/{session_id}/stop", headers=driver_headers).status_code == 200


def test_lovable_app_fields_are_persisted_with_garantido_mode(client, driver_headers):
    charger_id = free_charger_id(client, driver_headers)
    created = client.post(
        "/sessions",
        json={
            "charger_id": charger_id,
            "mode": "garantido",
            "vehicle_label": "BYD Dolphin",
            "target_pct": 80,
            "departure_time": "18:30",
        },
        headers=driver_headers,
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert (body["mode"], body["target_pct"], body["departure_time"]) == ("garantido", 80, "18:30")
    assert body["vehicle_label"] == "BYD Dolphin"
    assert body["charger_code"].startswith("CG-")


def test_invalid_departure_time_is_rejected(client, driver_headers):
    charger_id = free_charger_id(client, driver_headers)
    response = client.post(
        "/sessions", json={"charger_id": charger_id, "departure_time": "25:99"}, headers=driver_headers
    )
    assert response.status_code == 422


def test_seed_has_lovable_chargers_with_expected_codes(client):
    codes = {c["code"] for s in client.get("/stations").json() for c in s["chargers"]}
    assert {f"CG-00{i}" for i in range(1, 9)} <= codes
    assert login(client)  # login de demonstracao continua funcionando


def test_datetimes_are_serialized_as_utc_with_z_suffix(client, driver_headers):
    """Sem o 'Z' o navegador le o horario como local e mostra 3h de diferenca no Brasil."""
    charger_id = free_charger_id(client, driver_headers)
    session = client.post("/sessions", json={"charger_id": charger_id}, headers=driver_headers).json()
    assert session["started_at"].endswith("Z")
    assert session["ended_at"] is None

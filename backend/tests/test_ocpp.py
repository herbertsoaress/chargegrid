import base64
import json

import pytest
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.services import ocpp_csms, ocpp_service
from tests.conftest import free_charger_id

SUB = ["ocpp1.6"]


@pytest.fixture(autouse=True)
def _ocpp_db(db_factory):
    """Os handlers OCPP usam o mesmo banco (em arquivo) que o REST dos testes."""
    ocpp_csms.set_session_factory(db_factory)
    ocpp_csms.connected.clear()
    yield
    ocpp_csms.set_session_factory(None)


def call(ws, unique_id, action, payload):
    ws.send_text(json.dumps([2, unique_id, action, payload]))
    frame = json.loads(ws.receive_text())
    assert frame[1] == unique_id
    return frame


def driver_id(client, headers):
    return client.get("/auth/me", headers=headers).json()["id"]


def open_and_pay(client, headers, code="CG-002"):
    """O motorista abre a sessao e pre-autoriza o pagamento no app (A = 1)."""
    charger_id = free_charger_id(client, headers, code)
    session = client.post("/sessions", json={"charger_id": charger_id, "mode": "rapido"}, headers=headers).json()
    assert client.post(f"/sessions/{session['id']}/confirm-payment", headers=headers).status_code == 200
    return session["id"]


def session_of(client, headers, session_id):
    return client.get(f"/sessions/{session_id}", headers=headers).json()


def meter_frame(tx, energy_wh, power_w=7000, soc=40):
    return {
        "connectorId": 1,
        "transactionId": tx,
        "meterValue": [
            {
                "timestamp": "2026-09-20T12:00:00Z",
                "sampledValue": [
                    {"value": str(energy_wh), "measurand": "Energy.Active.Import.Register", "unit": "Wh"},
                    {"value": str(power_w), "measurand": "Power.Active.Import", "unit": "W"},
                    {"value": str(soc), "measurand": "SoC", "unit": "Percent"},
                ],
            }
        ],
    }


# ---------------- conexao ----------------
def test_boot_notification_is_accepted_and_charger_shows_as_connected(client, operator_headers):
    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB) as ws:
        frame = call(ws, "1", "BootNotification", {"chargePointVendor": "FIAP", "chargePointModel": "EV22"})
        assert frame[0] == 3 and frame[2]["status"] == "Accepted" and frame[2]["interval"] == settings.ocpp_heartbeat_interval
        assert "currentTime" in frame[2]

        status = client.get("/ocpp/status", headers=operator_headers).json()
        assert status["protocol"] == "OCPP 1.6J" and status["auth_required"] is False
        assert [c["code"] for c in status["connected"]] == ["CG-002"]
        assert status["connected"][0]["vendor"] == "FIAP" and status["connected"][0]["model"] == "EV22"
        assert client.get("/health").json()["ocpp"]["connected"] == 1
    assert client.get("/ocpp/status", headers=operator_headers).json()["connected"] == []  # desconectou


def test_heartbeat_returns_current_time(client):
    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB) as ws:
        frame = call(ws, "9", "Heartbeat", {})
        assert frame[0] == 3 and frame[2]["currentTime"].endswith(("Z", "+00:00"))


def test_unknown_charger_and_missing_subprotocol_are_rejected(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ocpp/CG-999", subprotocols=SUB):
            pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ocpp/CG-002"):  # sem o subprotocolo "ocpp1.6"
            pass


def test_disabled_csms_refuses_connections(client, monkeypatch):
    monkeypatch.setattr(settings, "ocpp_enabled", False)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB):
            pass


def test_shared_token_uses_http_basic_with_the_charger_code(client, monkeypatch):
    monkeypatch.setattr(settings, "ocpp_shared_token", "segredo123")
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB):
            pass  # sem senha

    def basic(user, password):
        return {"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB, headers=basic("CG-002", "errada")):
            pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB, headers=basic("CG-003", "segredo123")):
            pass  # usuario diferente do carregador
    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB, headers=basic("CG-002", "segredo123")) as ws:
        assert call(ws, "1", "Heartbeat", {})[0] == 3


def test_invalid_payload_gets_a_callerror(client):
    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB) as ws:
        frame = call(ws, "5", "BootNotification", {"chargePointVendor": "so o fabricante"})  # falta o modelo
        assert frame[0] == 4  # CALLERROR: a biblioteca valida contra o esquema oficial do OCPP 1.6


# ---------------- jornada da sessao pelo carregador ----------------
def test_full_journey_authorize_start_meter_stop(client, driver_headers, operator_headers):
    uid = driver_id(client, driver_headers)
    session_id = open_and_pay(client, driver_headers)
    assert not session_of(client, driver_headers, session_id)["power_released"]  # A sozinho nao libera energia

    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB) as ws:
        auth = call(ws, "1", "Authorize", {"idTag": f"USR-{uid}"})
        assert auth[2]["idTagInfo"]["status"] == "Accepted"

        start = call(ws, "2", "StartTransaction", {
            "connectorId": 1, "idTag": f"USR-{uid}", "meterStart": 500, "timestamp": "2026-09-20T12:00:00Z"})
        assert start[2]["idTagInfo"]["status"] == "Accepted" and start[2]["transactionId"] == session_id
        released = session_of(client, driver_headers, session_id)
        assert released["rfid_ok"] and released["cable_connected"] and released["power_released"]  # A.B.C => S = 1

        assert call(ws, "3", "MeterValues", meter_frame(session_id, energy_wh=2500, power_w=7000, soc=41.5))[0] == 3
        metered = session_of(client, driver_headers, session_id)
        assert metered["energy_kwh"] == 2.0  # (2500 - meterStart 500) Wh
        assert metered["current_power_kw"] == 7.0 and metered["current_pct"] == 41.5

        # o app paga e encerra por REST; o carregador informa o fim
        assert client.post(f"/sessions/{session_id}/pay", json={"method": "pix"}, headers=driver_headers).status_code == 200
        stop = call(ws, "4", "StopTransaction", {
            "transactionId": session_id, "meterStop": 2600, "timestamp": "2026-09-20T12:30:00Z", "reason": "Local"})
        assert stop[2]["idTagInfo"]["status"] == "Accepted"

    final = session_of(client, driver_headers, session_id)
    assert final["ended_at"] is not None  # D=1 + StopTransaction encerra e libera o carregador

    events = client.get(f"/sessions/{session_id}/events", headers=driver_headers).json()
    by_type = {e["type"]: e for e in events}
    assert by_type["rfid_authenticated"]["payload_json"].get("source") == "ocpp"
    assert by_type["cable_connected"]["payload_json"].get("source") == "ocpp"
    assert by_type["ocpp_start_transaction"]["payload_json"]["meter_start_wh"] == 500
    assert by_type["ocpp_stop_transaction"]["payload_json"]["meter_stop_wh"] == 2600
    assert by_type["meter_values"]["payload_json"]["source"] == "ocpp"


def test_start_without_payment_is_blocked_and_without_session_invalid(client, driver_headers):
    uid = driver_id(client, driver_headers)
    charger_id = free_charger_id(client, driver_headers, "CG-002")
    session = client.post("/sessions", json={"charger_id": charger_id, "mode": "rapido"}, headers=driver_headers).json()

    start = {"connectorId": 1, "idTag": f"USR-{uid}", "meterStart": 0, "timestamp": "2026-09-20T12:00:00Z"}
    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB) as ws:
        blocked = call(ws, "1", "StartTransaction", start)  # pagamento ainda nao pre-autorizado (A = 0)
        assert blocked[2]["idTagInfo"]["status"] == "Blocked"
        assert not session_of(client, driver_headers, session["id"])["power_released"]

        other = call(ws, "2", "StartTransaction", {**start, "idTag": "USR-99999"})
        assert other[2]["idTagInfo"]["status"] == "Invalid" and other[2]["transactionId"] == 0
    with client.websocket_connect("/ocpp/CG-003", subprotocols=SUB) as ws:  # outro carregador: sem sessao do motorista
        assert call(ws, "3", "StartTransaction", start)[2]["idTagInfo"]["status"] == "Invalid"


def test_authorize_only_accepts_registered_drivers(client, operator_headers):
    operator_id = driver_id(client, operator_headers)
    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB) as ws:
        assert call(ws, "1", "Authorize", {"idTag": "USR-99999"})[2]["idTagInfo"]["status"] == "Invalid"
        assert call(ws, "2", "Authorize", {"idTag": "cartao-qualquer"})[2]["idTagInfo"]["status"] == "Invalid"
        assert call(ws, "3", "Authorize", {"idTag": f"USR-{operator_id}"})[2]["idTagInfo"]["status"] == "Invalid"  # operador nao


def test_meter_values_after_payment_or_for_other_sessions_are_ignored(client, driver_headers):
    uid = driver_id(client, driver_headers)
    session_id = open_and_pay(client, driver_headers)
    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB) as ws:
        call(ws, "1", "StartTransaction", {
            "connectorId": 1, "idTag": f"USR-{uid}", "meterStart": 0, "timestamp": "2026-09-20T12:00:00Z"})
        call(ws, "2", "MeterValues", meter_frame(session_id, 1000))
        assert client.post(f"/sessions/{session_id}/pay", json={"method": "pix"}, headers=driver_headers).status_code == 200
        before = session_of(client, driver_headers, session_id)["energy_kwh"]
        assert call(ws, "3", "MeterValues", meter_frame(session_id, 9000))[0] == 3  # leitura tardia: nao quebra
        assert call(ws, "4", "MeterValues", meter_frame(424242, 500))[0] == 3  # transacao inexistente
        assert session_of(client, driver_headers, session_id)["energy_kwh"] == before  # a conta ja fechada nao muda


def test_stop_before_payment_keeps_the_session_open(client, driver_headers):
    uid = driver_id(client, driver_headers)
    session_id = open_and_pay(client, driver_headers)
    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB) as ws:
        call(ws, "1", "StartTransaction", {
            "connectorId": 1, "idTag": f"USR-{uid}", "meterStart": 0, "timestamp": "2026-09-20T12:00:00Z"})
        call(ws, "2", "StopTransaction", {"transactionId": session_id, "meterStop": 100, "timestamp": "2026-09-20T12:01:00Z"})
    after = session_of(client, driver_headers, session_id)
    assert after["ended_at"] is None  # trava ainda fechada (D = 0): o motorista precisa pagar antes


# ---------------- status do carregador ----------------
def test_status_notification_moves_the_charger_to_maintenance_and_back(client, driver_headers, operator_headers):
    def charger_status(code):
        stations = client.get("/stations").json()
        return next(c["status"] for s in stations for c in s["chargers"] if c["code"] == code)

    with client.websocket_connect("/ocpp/CG-004", subprotocols=SUB) as ws:
        call(ws, "1", "StatusNotification", {"connectorId": 1, "errorCode": "GroundFailure", "status": "Faulted"})
        assert charger_status("CG-004") == "manutencao"
        logs = client.get("/goodwe/logs?limit=20", headers=operator_headers).json()
        assert any(l["source"] == "ocpp" and l["level"] == "WARN" and "CG-004" in l["message"] for l in logs)

        call(ws, "2", "StatusNotification", {"connectorId": 1, "errorCode": "NoError", "status": "Available"})
        assert charger_status("CG-004") == "livre"

        call(ws, "3", "StatusNotification", {"connectorId": 2, "errorCode": "NoError", "status": "Faulted"})  # outro conector
        assert charger_status("CG-004") == "livre"


# ---------------- log das mensagens ----------------
def test_every_frame_is_logged_with_direction_and_action(client, driver_headers, operator_headers):
    with client.websocket_connect("/ocpp/CG-002", subprotocols=SUB) as ws:
        call(ws, "77", "Heartbeat", {})
    messages = client.get("/ocpp/messages?charger=CG-002", headers=operator_headers).json()
    mine = [m for m in messages if m["unique_id"] == "77"]
    assert {(m["direction"], m["message_type"], m["action"]) for m in mine} == {("in", 2, "Heartbeat"), ("out", 3, "Heartbeat")}
    assert next(m for m in mine if m["direction"] == "out")["payload_json"]["currentTime"]  # a resposta guarda o payload

    assert client.get("/ocpp/messages", headers=driver_headers).status_code == 403
    assert client.get("/ocpp/messages").status_code == 401
    assert client.get("/ocpp/status", headers=driver_headers).status_code == 403
    assert client.get("/ocpp/messages?limit=0", headers=operator_headers).status_code == 422


def test_log_frame_survives_garbage_and_old_messages_are_pruned(db_factory):
    db = db_factory()
    try:
        ocpp_service.log_frame(db, "CG-002", "in", "isto nao e json", {})
        ocpp_service.log_frame(db, "CG-002", "in", json.dumps([4, "x", "GenericError", "falhou", {}]), {"x": "Heartbeat"})
        rows = db.query(ocpp_service.OcppMessage).order_by(ocpp_service.OcppMessage.id).all()
        assert rows[0].message_type == 0 and rows[0].payload_json["raw"].startswith("isto")
        assert rows[1].message_type == 4 and rows[1].action == "Heartbeat" and rows[1].payload_json["codigo"] == "GenericError"

        for row in rows:
            row.created_at = ocpp_service.utcnow().replace(year=2020)
        db.commit()
        assert ocpp_service.prune_old_messages(db, 7) == 2
    finally:
        db.close()


def test_parse_samples_handles_units_and_both_key_styles():
    snake = [{"sampled_value": [{"value": "1500", "unit": "Wh"}, {"value": "7400", "measurand": "Power.Active.Import", "unit": "W"}]}]
    camel = [{"sampledValue": [{"value": "2.5", "unit": "kWh"}, {"value": "7.4", "measurand": "Power.Active.Import", "unit": "kW"},
                               {"value": "55", "measurand": "SoC", "unit": "Percent"}, {"value": "x", "measurand": "SoC"}]}]
    assert ocpp_service.parse_samples(snake) == {"energy_wh": 1500.0, "power_kw": 7.4}
    assert ocpp_service.parse_samples(camel) == {"energy_wh": 2500.0, "power_kw": 7.4, "soc_pct": 55.0}
    assert ocpp_service.parse_samples([]) == {} and ocpp_service.parse_samples(None) == {}


def test_id_tag_roundtrip():
    assert ocpp_service.id_tag_for_user(12) == "USR-12"

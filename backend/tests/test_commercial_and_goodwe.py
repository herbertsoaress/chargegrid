from app.services import goodwe_adapter
from app.services.goodwe_adapter import GoodWeIntegrationError, mask_serial
from tests.conftest import expected_amount, free_charger_id, start_charging


# ---------------- medidor (MeterValues) e comprovante ----------------
def test_meter_values_require_energy_released(client, driver_headers):
    charger_id = free_charger_id(client, driver_headers)
    sid = client.post("/sessions", json={"charger_id": charger_id}, headers=driver_headers).json()["id"]
    early = client.post(
        f"/sessions/{sid}/meter-values", json={"energy_kwh": 1, "power_kw": 10}, headers=driver_headers
    )
    assert early.status_code == 409


def test_reported_energy_drives_amount_and_receipt(client, driver_headers, operator_headers):
    session = start_charging(client, driver_headers, free_charger_id(client, driver_headers), target_pct=80)
    sid = session["id"]

    first = client.post(
        f"/sessions/{sid}/meter-values", json={"energy_kwh": 4.0, "power_kw": 14.5}, headers=driver_headers
    )
    assert first.status_code == 200, first.text
    # o medidor nunca anda para tras
    second = client.post(
        f"/sessions/{sid}/meter-values", json={"energy_kwh": 3.0, "power_kw": 12.0}, headers=driver_headers
    )
    assert second.json()["energy_kwh"] == 4.0

    # sem pagamento ainda nao ha comprovante
    assert client.get(f"/sessions/{sid}/receipt", headers=driver_headers).status_code == 409

    client.post(f"/sessions/{sid}/pay", json={"method": "pix"}, headers=driver_headers)
    client.post(f"/sessions/{sid}/stop", headers=driver_headers)

    receipt = client.get(f"/sessions/{sid}/receipt", headers=driver_headers).json()
    assert receipt["energy_kwh"] == 4.0
    # valor = energia (preco do modelo + acrescimo do modo "rapido") + tempo de uso; sem ociosidade aqui
    assert receipt["amount"] == expected_amount(4.0, receipt["price_per_kwh"])
    assert receipt["amount"] == round(receipt["energy_amount"] + receipt["time_amount"] + receipt["idle_amount"], 2)
    assert receipt["payment"]["provider_ref"].startswith("SANDBOX-PIX-")
    assert receipt["receipt_number"].startswith("CG-") and receipt["origem"] == "sandbox"

    invoices = client.get("/billing/invoices", headers=operator_headers).json()
    assert invoices[0]["receipt_number"] == receipt["receipt_number"]
    assert invoices[0]["amount"] == receipt["amount"]
    assert invoices[0]["user_name"] == "João S."  # nome abreviado em tela operacional


def test_meter_values_after_payment_are_rejected(client, driver_headers):
    sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers))["id"]
    client.post(f"/sessions/{sid}/pay", json={"method": "cartao"}, headers=driver_headers)
    late = client.post(f"/sessions/{sid}/meter-values", json={"energy_kwh": 9, "power_kw": 1}, headers=driver_headers)
    assert late.status_code == 409


def test_simulated_controller_is_used_when_no_meter_reported(client, driver_headers):
    sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers))["id"]
    payment = client.post(f"/sessions/{sid}/pay", json={"method": "pix"}, headers=driver_headers)
    assert payment.status_code == 200
    session = client.get(f"/sessions/{sid}", headers=driver_headers).json()
    assert session["energy_kwh"] >= 0 and session["amount_due"] == payment.json()["amount"]


def test_billing_summary_and_events_reflect_persisted_sessions(client, driver_headers, operator_headers):
    sid = start_charging(client, driver_headers, free_charger_id(client, driver_headers))["id"]
    client.post(f"/sessions/{sid}/meter-values", json={"energy_kwh": 2.5, "power_kw": 20}, headers=driver_headers)
    summary = client.get("/billing/summary", headers=operator_headers).json()
    assert summary["active_sessions"] == 1 and summary["network_used_kw"] > 0

    events = client.get("/events", headers=operator_headers).json()
    assert {"session_created", "cable_connected", "meter_values"} <= {e["type"] for e in events}
    assert all(e["charger_code"].startswith("CG-") for e in events)


def test_peak_shaving_is_audited(client, operator_headers, driver_headers):
    assert client.post("/ops/peak-shaving", json={}, headers=driver_headers).status_code == 403
    assert client.post("/ops/peak-shaving", json={}, headers=operator_headers).status_code == 200
    logs = client.get("/goodwe/logs", headers=operator_headers).json()
    assert logs[0]["source"] == "load-balancer" and logs[0]["payload_json"]["simulado"] is True


# ---------------- integracao GoodWe ----------------
def test_goodwe_plants_and_devices_are_simulated_and_masked(client, operator_headers):
    plants = client.get("/goodwe/plants", headers=operator_headers).json()
    assert plants[0]["origem"] == "simulado" and plants[0]["capacity_kw"] == 7.5
    devices = client.get("/goodwe/devices", headers=operator_headers).json()
    assert {d["type"] for d in devices} >= {"ES ID"}
    assert all(d["serial_masked"].startswith("****") for d in devices)
    assert mask_serial("ABCDEF123456") == "****3456"


def test_telemetry_is_persisted_but_throttled(client, db_factory, operator_headers):
    from app.models import GoodWeReading

    station_id = client.get("/stations").json()[0]["id"]
    for _ in range(3):
        response = client.get(f"/stations/{station_id}/telemetry", headers=operator_headers)
        assert response.status_code == 200 and response.json()["origem"] == "simulado"
    db = db_factory()
    assert db.query(GoodWeReading).count() == 1  # 3 leituras em poucos segundos => 1 linha
    db.close()


def test_goodwe_failure_becomes_502_and_is_logged(client, operator_headers, monkeypatch):
    class BrokenAdapter(goodwe_adapter.SimulatedGoodWeAdapter):
        def list_plants(self):
            raise GoodWeIntegrationError("timeout na GoodWe")

    monkeypatch.setattr("app.routers.goodwe.get_adapter", lambda: BrokenAdapter())
    response = client.get("/goodwe/plants", headers=operator_headers)
    assert response.status_code == 502
    assert "timeout" in response.json()["detail"]
    logs = client.get("/goodwe/logs", headers=operator_headers).json()
    assert logs[0]["level"] == "ERR" and logs[0]["source"] == "goodwe"


def test_real_adapter_activates_only_with_credentials(monkeypatch):
    from app.config import settings

    assert goodwe_adapter.get_adapter().origem == "simulado"
    monkeypatch.setattr(settings, "goodwe_app_id", "id")
    monkeypatch.setattr(settings, "goodwe_app_secret", "secret")
    adapter = goodwe_adapter.get_adapter()
    assert adapter.origem == "real" and "somente leitura" in adapter.get_status()["detalhe"]


def test_users_list_reports_total_spent_from_finished_sessions(client, driver_headers, operator_headers):
    driver = next(u for u in client.get("/users", headers=operator_headers).json() if u["email"] == "motorista@chargegrid.demo")
    assert driver["total_spent"] == 0 and driver["total_sessions"] == 0

    session = start_charging(client, driver_headers, free_charger_id(client, driver_headers))
    assert client.post(f"/sessions/{session['id']}/pay", json={"method": "pix"}, headers=driver_headers).status_code == 200
    assert client.post(f"/sessions/{session['id']}/stop", headers=driver_headers).status_code == 200

    driver = next(u for u in client.get("/users", headers=operator_headers).json() if u["email"] == "motorista@chargegrid.demo")
    assert driver["total_sessions"] == 1
    assert driver["total_spent"] == client.get(f"/sessions/{session['id']}/receipt", headers=driver_headers).json()["amount"]

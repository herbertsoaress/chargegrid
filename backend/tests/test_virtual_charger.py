import asyncio
import socket
import threading
import time
from types import SimpleNamespace

import httpx
import pytest
import uvicorn

from app.config import settings
from app.db import get_db
from app.main import app
from app.services import ocpp_csms
from app.services.simulator import BATTERY_KWH
from app.services.virtual_charger import VirtualCharger
from tests.conftest import free_charger_id


class FakeCp:
    """Faz o papel da conexao OCPP: guarda o que o carregador virtual mandou e responde como um CSMS."""

    def __init__(self, authorize="Accepted", start="Accepted"):
        self.calls = []
        self.authorize, self.start = authorize, start

    async def call(self, request):
        self.calls.append(request)
        name = type(request).__name__
        if name == "Authorize":
            return SimpleNamespace(id_tag_info={"status": self.authorize})
        if name == "StartTransaction":
            return SimpleNamespace(transaction_id=42, id_tag_info={"status": self.start})
        return SimpleNamespace()

    @property
    def names(self):
        return [type(c).__name__ for c in self.calls]

    def statuses(self):
        return [c.status for c in self.calls if type(c).__name__ == "StatusNotification"]


def snapshot(session=None, charger_status="livre"):
    return {"charger_status": charger_status, "max_power_kw": 22.0, "session": session}


def paid_session(**over):
    base = {"id": 7, "user_id": 3, "payment_confirmed": True, "rfid_ok": False, "power_released": False,
            "payment_finalized": False, "nominal_power_kw": 22.0, "current_pct": 28.0}
    return {**base, **over}


def make(**kwargs):
    charger = VirtualCharger("CG-002", url="ws://x", speedup=60, meter_interval_s=2, poll_s=0.01, **kwargs)
    charger.last_heartbeat = 10**9  # o heartbeat so atrapalha estes testes
    return charger


def run(coro):
    return asyncio.run(coro)


# ---------------- maquina de estados do carregador (sem rede) ----------------
def test_idle_charger_reports_available_once():
    charger, cp = make(), FakeCp()
    run(charger.step(cp, snapshot(), 0.0))
    run(charger.step(cp, snapshot(), 1.0))
    assert cp.names == ["StatusNotification"] and cp.statuses() == ["Available"]  # nao repete o mesmo status


def test_charger_in_maintenance_reports_unavailable():
    charger, cp = make(), FakeCp()
    run(charger.step(cp, snapshot(charger_status="manutencao"), 0.0))
    assert cp.statuses() == ["Unavailable"] and cp.calls[0].error_code == "OtherError"


def test_paid_session_triggers_authorize_and_start_transaction():
    charger, cp = make(), FakeCp()
    run(charger.step(cp, snapshot(paid_session()), 100.0))
    assert cp.names == ["StatusNotification", "Authorize", "StartTransaction", "StatusNotification"]
    assert cp.statuses() == ["Preparing", "Charging"]
    assert cp.calls[1].id_tag == "USR-3" and cp.calls[2].id_tag == "USR-3" and cp.calls[2].meter_start == 0
    assert charger.tx.session_id == 7 and charger.tx.transaction_id == 42


def test_unpaid_session_waits_and_blocked_start_retries_later():
    charger, cp = make(), FakeCp()
    run(charger.step(cp, snapshot(paid_session(payment_confirmed=False)), 100.0))
    assert charger.tx is None and "Authorize" not in cp.names  # sem pagamento pre-autorizado nao faz nada

    blocked = FakeCp(start="Blocked")
    run(charger.step(blocked, snapshot(paid_session()), 100.0))
    assert charger.tx is None and charger.retry_start_after == pytest.approx(105.0)  # espera 5 s
    run(charger.step(blocked, snapshot(paid_session()), 102.0))
    assert blocked.names.count("Authorize") == 1  # ainda esperando

    refused = FakeCp(authorize="Invalid")
    other = make()
    run(other.step(refused, snapshot(paid_session()), 100.0))
    assert other.tx is None and "StartTransaction" not in refused.names


def test_meter_values_follow_power_time_and_speedup():
    charger, cp = make(), FakeCp()
    run(charger.step(cp, snapshot(paid_session()), 100.0))  # comeca a recarga em t=100
    cp.calls.clear()
    run(charger.step(cp, snapshot(paid_session(rfid_ok=True, power_released=True)), 101.0))
    assert "MeterValues" not in cp.names  # ainda nao passou o intervalo (2 s)

    run(charger.step(cp, snapshot(paid_session(rfid_ok=True, power_released=True)), 110.0))
    meter = next(c for c in cp.calls if type(c).__name__ == "MeterValues")
    samples = {s["measurand"]: s for s in meter.meter_value[0]["sampled_value"]}
    # 22 kW por 10 s reais x 60 = 600 s simulados = 3,667 kWh
    assert float(samples["Energy.Active.Import.Register"]["value"]) == pytest.approx(3667, abs=1)
    assert samples["Energy.Active.Import.Register"]["unit"] == "Wh"
    assert float(samples["Power.Active.Import"]["value"]) == 22000 and samples["Power.Active.Import"]["unit"] == "W"
    assert float(samples["SoC"]["value"]) == pytest.approx(28 + 3.667 / BATTERY_KWH * 100, abs=0.1)
    assert meter.transaction_id == 42 and meter.connector_id == 1


def test_full_battery_stops_delivering_power():
    charger, cp = make(), FakeCp()
    run(charger.step(cp, snapshot(paid_session()), 0.0))
    cp.calls.clear()
    run(charger.step(cp, snapshot(paid_session(rfid_ok=True, power_released=True)), 10_000.0))  # muito tempo depois
    samples = {s["measurand"]: float(s["value"]) for s in cp.calls[0].meter_value[0]["sampled_value"]}
    assert samples["Energy.Active.Import.Register"] == pytest.approx((100 - 28) / 100 * BATTERY_KWH * 1000, abs=1)
    assert samples["SoC"] == 100.0 and samples["Power.Active.Import"] == 0


def test_session_end_sends_stop_transaction_and_returns_to_available():
    charger, cp = make(), FakeCp()
    run(charger.step(cp, snapshot(paid_session()), 0.0))
    run(charger.step(cp, snapshot(paid_session(rfid_ok=True, power_released=True)), 10.0))
    cp.calls.clear()
    run(charger.step(cp, snapshot(None), 12.0))  # o app pagou e encerrou: a sessao sumiu do banco
    assert cp.names == ["StopTransaction", "StatusNotification", "StatusNotification"]
    stop = cp.calls[0]
    assert stop.transaction_id == 42 and stop.meter_stop == pytest.approx(3667, abs=1) and stop.reason == "Local"
    assert cp.statuses() == ["Finishing", "Available"] and charger.tx is None


def test_heartbeat_is_sent_periodically():
    charger, cp = VirtualCharger("CG-002", url="ws://x"), FakeCp()
    run(charger.step(cp, snapshot(), 100.0))
    assert cp.names[0] == "Heartbeat"
    cp.calls.clear()
    run(charger.step(cp, snapshot(), 101.0))
    assert "Heartbeat" not in cp.names  # ainda dentro do intervalo
    run(charger.step(cp, snapshot(), 100.0 + settings.ocpp_heartbeat_interval + 1))
    assert "Heartbeat" in cp.names


# ---------------- ponta a ponta: servidor de verdade + WebSocket de verdade ----------------
def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def live_server(db_factory):
    def override_get_db():
        db = db_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    ocpp_csms.set_session_factory(db_factory)
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.1)
    assert server.started, "servidor de teste nao subiu"
    yield port
    server.should_exit = True
    thread.join(timeout=10)
    app.dependency_overrides.clear()
    ocpp_csms.set_session_factory(None)


def test_virtual_charger_runs_a_full_session_over_a_real_websocket(live_server):
    base = f"http://127.0.0.1:{live_server}"

    async def scenario():
        async with httpx.AsyncClient(base_url=base, timeout=10) as http:
            async def login(email):
                r = await http.post("/auth/login", json={"email": email, "password": "chargegrid123"})
                return {"Authorization": f"Bearer {r.json()['access_token']}"}

            driver, operator = await login("motorista@chargegrid.demo"), await login("operador@chargegrid.demo")
            stations = (await http.get("/stations")).json()
            charger = next(c for s in stations for c in s["chargers"] if c["code"] == "CG-002")

            created = (await http.post("/sessions", json={"charger_id": charger["id"], "mode": "rapido"}, headers=driver)).json()
            sid = created["id"]
            await http.post(f"/sessions/{sid}/confirm-payment", headers=driver)  # A: o app pre-autoriza o pagamento

            # so agora o carregador virtual liga: ele encontra a sessao e conduz Authorize -> Start -> MeterValues
            virtual = VirtualCharger("CG-002", url=f"ws://127.0.0.1:{live_server}", speedup=3600,
                                     meter_interval_s=0.2, poll_s=0.1)
            task = asyncio.create_task(virtual.run_forever())
            try:
                async def wait_for(check, timeout=15):
                    deadline = time.monotonic() + timeout
                    while time.monotonic() < deadline:
                        value = await check()
                        if value:
                            return value
                        await asyncio.sleep(0.15)
                    raise AssertionError("tempo esgotado esperando o carregador virtual")

                async def charging():
                    s = (await http.get(f"/sessions/{sid}", headers=driver)).json()
                    return s if s["power_released"] and s["energy_kwh"] > 0.5 else None

                live = await wait_for(charging)
                assert live["rfid_ok"] and live["cable_connected"] and live["current_power_kw"] > 0

                assert (await http.post(f"/sessions/{sid}/pay", json={"method": "pix"}, headers=driver)).status_code == 200
                assert (await http.post(f"/sessions/{sid}/stop", headers=driver)).status_code == 200

                async def stopped():
                    msgs = (await http.get("/ocpp/messages?charger=CG-002&limit=200", headers=operator)).json()
                    return msgs if any(m["action"] == "StopTransaction" and m["direction"] == "in" for m in msgs) else None

                messages = await wait_for(stopped)
                actions = {m["action"] for m in messages if m["direction"] == "in"}
                assert {"BootNotification", "StatusNotification", "Authorize", "StartTransaction",
                        "MeterValues", "StopTransaction"} <= actions
                events = (await http.get(f"/sessions/{sid}/events", headers=driver)).json()
                assert {e["type"] for e in events} >= {"rfid_authenticated", "cable_connected", "ocpp_start_transaction",
                                                       "ocpp_stop_transaction"}
                receipt = (await http.get(f"/sessions/{sid}/receipt", headers=driver)).json()
                assert receipt["energy_kwh"] > 0.5 and receipt["amount"] > 0  # energia medida pelo carregador via OCPP
                status = (await http.get("/ocpp/status", headers=operator)).json()
                assert [c["code"] for c in status["connected"]] == ["CG-002"]
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())

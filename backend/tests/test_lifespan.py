import time

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import modbus_meter, ocpp_csms
from tests.conftest import login


def wait_until(check, timeout=8.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.1)
    return False


@pytest.fixture(autouse=True)
def _clean():
    modbus_meter.state.reading = modbus_meter.state.read_at = modbus_meter.state.read_at_utc = None
    modbus_meter.state.error = None
    yield
    modbus_meter.state.reading = modbus_meter.state.read_at = modbus_meter.state.read_at_utc = None


def test_backend_starts_and_stops_cleanly_with_the_modbus_simulator(db_factory, monkeypatch):
    monkeypatch.setattr(settings, "modbus_simulator", True)
    monkeypatch.setattr(settings, "modbus_port", 0)  # a porta e escolhida pelo sistema
    ocpp_csms.set_session_factory(db_factory)
    try:
        with TestClient(app) as client:
            assert wait_until(lambda: modbus_meter.fresh_reading() is not None), "o leitor nao recebeu leitura do medidor"
            reading = modbus_meter.fresh_reading()
            assert 60_000 < reading["active_power_w"] < 200_000  # predio do cenario (~120 kW) medido pelo MODBUS
            assert client.get("/health").json()["modbus"] == {"simulator": True}
        # sair do "with" nao pode travar (o servidor fecha as conexoes do leitor) e limpa a ultima leitura
        assert modbus_meter.state.reading is None
    finally:
        ocpp_csms.set_session_factory(None)


def test_metered_building_load_reaches_the_balancing_endpoint(db_factory, monkeypatch):
    monkeypatch.setattr(settings, "modbus_simulator", True)
    monkeypatch.setattr(settings, "modbus_port", 0)
    from app.db import get_db

    def override_get_db():
        db = db_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    ocpp_csms.set_session_factory(db_factory)
    try:
        with TestClient(app) as client:
            assert wait_until(lambda: modbus_meter.fresh_reading() is not None)
            headers = login(client, "operador@chargegrid.demo")
            balancing = client.get("/billing/balancing", headers=headers).json()
            assert balancing["building_source"] == "modbus" and balancing["ev_load_kw"] == 0.0
            meter = client.get("/ops/meter", headers=headers).json()
            assert meter["fresh"] and meter["origem"] == "simulado" and meter["error"] is None
            assert meter["reading"]["import_energy_kwh"] >= 15000  # contador acumulado (nunca abaixo do inicio)
    finally:
        app.dependency_overrides.clear()
        ocpp_csms.set_session_factory(None)


def test_backend_stops_cleanly_with_the_ocpp_simulator_and_no_server_listening(db_factory, monkeypatch):
    """Os carregadores virtuais tentam conectar em vao (nada escuta na porta) e mesmo assim o desligamento nao trava."""
    monkeypatch.setattr(settings, "ocpp_simulator", True)
    monkeypatch.setattr(settings, "ocpp_simulator_url", "ws://127.0.0.1:9")  # porta sem servico
    ocpp_csms.set_session_factory(db_factory)
    started = time.monotonic()
    try:
        with TestClient(app) as client:
            time.sleep(0.5)
            assert client.get("/health").json()["ocpp"]["simulator"] is True
        assert time.monotonic() - started < 15
    finally:
        ocpp_csms.set_session_factory(None)

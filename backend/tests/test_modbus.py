import asyncio
import random
import struct
import time
from datetime import UTC, datetime

import pytest
from pymodbus.client import AsyncModbusTcpClient

from app.config import settings
from app.services import modbus_meter
from app.services.modbus_meter import (
    REGISTER_COUNT,
    REGISTER_MAP,
    MeterPoller,
    SimulatedMeterServer,
    decode_float,
    decode_registers,
    encode_float,
    simulate_reading,
)

SAMPLE = {
    "voltage_l1_v": 127.5, "voltage_l2_v": 127.1, "voltage_l3_v": 126.9,
    "current_l1_a": 100.25, "current_l2_a": 99.5, "current_l3_a": 101.0,
    "active_power_w": 123456.0, "frequency_hz": 60.02, "import_energy_kwh": 15234.5,
}


@pytest.fixture(autouse=True)
def _reset_state():
    modbus_meter.state.reading = modbus_meter.state.read_at = modbus_meter.state.read_at_utc = None
    modbus_meter.state.error = None
    yield
    modbus_meter.state.reading = modbus_meter.state.read_at = modbus_meter.state.read_at_utc = None
    modbus_meter.state.error = None


async def raw_request(port, function, address, quantity, unit=1, transaction=7):
    """Fala MODBUS TCP "na mao" (bytes), sem biblioteca, para provar o formato do quadro."""
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    try:
        pdu = struct.pack(">BHH", function, address, quantity)
        writer.write(struct.pack(">HHHB", transaction, 0, len(pdu) + 1, unit) + pdu)
        await writer.drain()
        header = await asyncio.wait_for(reader.readexactly(7), timeout=1)
        tid, protocol, length, unit_id = struct.unpack(">HHHB", header)
        body = await reader.readexactly(length - 1)
        return tid, protocol, unit_id, body
    finally:
        writer.close()


# ---------------- codificacao ----------------
def test_float32_roundtrip_over_two_registers():
    high, low = encode_float(127.4)
    assert 0 <= high <= 0xFFFF and 0 <= low <= 0xFFFF
    assert decode_float(high, low) == pytest.approx(127.4, abs=1e-4)
    assert (high, low) == struct.unpack(">HH", struct.pack(">f", 127.4))  # IEEE-754, palavra alta primeiro


def test_register_map_is_consistent():
    addresses = [a for a, _n, _u in REGISTER_MAP]
    assert addresses == sorted(set(addresses)) and all(b - a == 2 for a, b in zip(addresses, addresses[1:]))
    assert addresses[-1] + 2 == REGISTER_COUNT


# ---------------- servidor MODBUS TCP ----------------
def test_server_answers_function_4_with_a_correct_frame():
    async def scenario():
        server = SimulatedMeterServer("127.0.0.1", 0, unit_id=1)
        await server.start()
        server.set_values(SAMPLE)
        try:
            tid, protocol, unit, body = await raw_request(server.port, 4, 0, 2)
            assert (tid, protocol, unit) == (7, 0, 1)  # transacao devolvida, protocolo 0, unit id
            assert body[0] == 4 and body[1] == 4  # funcao e "byte count" (2 registradores x 2 bytes)
            assert decode_float(*struct.unpack(">HH", body[2:6])) == pytest.approx(127.5, abs=1e-4)

            _, _, _, holding = await raw_request(server.port, 3, 12, 2)  # funcao 3 (retencao): mesmo bloco
            assert decode_float(*struct.unpack(">HH", holding[2:6])) == 123456.0
        finally:
            await server.stop()

    asyncio.run(scenario())


def test_server_returns_modbus_exceptions():
    async def scenario():
        server = SimulatedMeterServer("127.0.0.1", 0, unit_id=1)
        await server.start()
        try:
            assert (await raw_request(server.port, 4, 17, 2))[3] == bytes([0x84, 2])  # endereco alem do mapa
            assert (await raw_request(server.port, 4, 0, 0))[3] == bytes([0x84, 3])  # quantidade 0
            assert (await raw_request(server.port, 3, 0, 126))[3] == bytes([0x83, 3])  # quantidade > 125
            assert (await raw_request(server.port, 6, 0, 1))[3] == bytes([0x86, 1])  # escrita: medidor somente leitura
        finally:
            await server.stop()

    asyncio.run(scenario())


def test_server_ignores_other_unit_ids_and_survives_garbage():
    async def scenario():
        server = SimulatedMeterServer("127.0.0.1", 0, unit_id=1)
        await server.start()
        try:
            with pytest.raises(asyncio.TimeoutError):
                await raw_request(server.port, 4, 0, 2, unit=9)  # outro dispositivo: nao responde
            reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
            writer.write(b"\xff" * 20)  # lixo (protocolo != 0)
            await writer.drain()
            assert await asyncio.wait_for(reader.read(), timeout=1) == b""  # o servidor fecha a conexao
            writer.close()
            assert (await raw_request(server.port, 4, 0, 2))[3][0] == 4  # e continua atendendo os outros
        finally:
            await server.stop()

    asyncio.run(scenario())


def test_server_interoperates_with_the_pymodbus_client():
    """O cliente do pymodbus (implementacao independente) le o nosso medidor: prova que o protocolo esta certo."""

    async def scenario():
        server = SimulatedMeterServer("127.0.0.1", 0, unit_id=1)
        await server.start()
        server.set_values(SAMPLE)
        client = AsyncModbusTcpClient("127.0.0.1", port=server.port, timeout=2)
        try:
            await client.connect()
            result = await client.read_input_registers(0, count=REGISTER_COUNT, device_id=1)
            assert not result.isError() and len(result.registers) == REGISTER_COUNT
            values = decode_registers(list(result.registers))
            for name, expected in SAMPLE.items():
                assert values[name] == pytest.approx(expected, rel=1e-5), name
            partial = await client.read_input_registers(12, count=2, device_id=1)
            assert decode_float(*partial.registers) == 123456.0
            bad = await client.read_input_registers(40, count=2, device_id=1)
            assert bad.isError()  # excecao MODBUS chega como erro no cliente
        finally:
            client.close()
            await server.stop()

    asyncio.run(scenario())


# ---------------- leitor ----------------
def test_poller_reads_the_meter_and_reports_failures():
    async def scenario():
        server = SimulatedMeterServer("127.0.0.1", 0, unit_id=1)
        await server.start()
        server.set_values(SAMPLE)
        task = asyncio.create_task(MeterPoller("127.0.0.1", server.port, 1, interval_s=0.05).run())
        try:
            for _ in range(60):
                if modbus_meter.state.reading:
                    break
                await asyncio.sleep(0.05)
            assert modbus_meter.state.reading["active_power_w"] == 123456.0
            assert modbus_meter.state.error is None and modbus_meter.fresh_reading() is not None
            assert modbus_meter.state.age_s() < 2

            await server.stop()  # o medidor "cai"
            modbus_meter.state.read_at = time.monotonic() - 60  # e a ultima leitura envelhece
            for _ in range(80):
                if modbus_meter.state.error:
                    break
                await asyncio.sleep(0.05)
            assert modbus_meter.state.error  # falha registrada, sem derrubar o backend
            assert modbus_meter.fresh_reading() is None  # leitura velha nao e usada
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())


# ---------------- simulacao das leituras ----------------
def test_simulated_reading_follows_the_daily_curve_and_adds_ev_load():
    rng = random.Random(1)
    night = simulate_reading(0.5, 0.0, 15000.0, 1.0, rng)
    noon = simulate_reading(12.0, 0.0, 15000.0, 1.0, random.Random(1))
    with_evs = simulate_reading(12.0, 40.0, 15000.0, 1.0, random.Random(1))
    assert night["active_power_w"] < noon["active_power_w"]  # predio consome mais ao meio-dia
    assert with_evs["active_power_w"] - noon["active_power_w"] == pytest.approx(40_000, abs=1)
    assert 100_000 < noon["active_power_w"] < 150_000  # perto dos 120 kW do cenario
    assert all(123 < noon[f"voltage_l{i}_v"] < 131 for i in (1, 2, 3)) and 59.9 < noon["frequency_hz"] < 60.1
    assert noon["current_l1_a"] == pytest.approx(noon["active_power_w"] / (3 * noon["voltage_l1_v"]), rel=0.05)
    assert noon["import_energy_kwh"] > 15000.0  # a energia so cresce


# ---------------- API ----------------
def test_meter_endpoint_is_operator_only_and_always_says_simulated(client, driver_headers, operator_headers):
    assert client.get("/ops/meter").status_code == 401
    assert client.get("/ops/meter", headers=driver_headers).status_code == 403
    body = client.get("/ops/meter", headers=operator_headers).json()
    assert body["protocol"] == "MODBUS TCP" and body["origem"] == "simulado" and body["reading"] is None
    assert body["fresh"] is False and len(body["register_map"]) == len(REGISTER_MAP)

    modbus_meter.state.reading = dict(SAMPLE)
    modbus_meter.state.read_at, modbus_meter.state.read_at_utc = time.monotonic(), datetime.now(UTC)
    body = client.get("/ops/meter", headers=operator_headers).json()
    assert body["fresh"] is True and body["reading"]["active_power_w"] == 123456.0 and body["age_s"] < 2


def test_balancing_uses_the_meter_when_fresh_and_the_scenario_otherwise(client, operator_headers):
    scenario = client.get("/billing/balancing", headers=operator_headers).json()
    assert scenario["building_source"] == "cenario" and scenario["building_load_kw"] == settings.site_base_load_kw

    modbus_meter.state.reading = {**SAMPLE, "active_power_w": 150_000.0}
    modbus_meter.state.read_at = time.monotonic()
    metered = client.get("/billing/balancing", headers=operator_headers).json()
    assert metered["building_source"] == "modbus" and metered["building_load_kw"] == 150.0  # total - carros (0 aqui)
    assert metered["total_demand_kw"] == 150.0

    modbus_meter.state.read_at = time.monotonic() - 60  # leitura velha volta para o cenario
    assert client.get("/billing/balancing", headers=operator_headers).json()["building_source"] == "cenario"


def test_health_reports_modbus_flag(client):
    assert client.get("/health").json()["modbus"] == {"simulator": False}

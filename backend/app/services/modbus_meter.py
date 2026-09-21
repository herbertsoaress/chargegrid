"""Medidor de energia SIMULADO com MODBUS TCP (pilar "Protocolos abertos" do playbook GoodWe).

Tres pecas, todas rodando dentro do backend quando MODBUS_SIMULATOR=true:

  * `SimulatedMeterServer`  um "medidor" que fala MODBUS TCP de verdade (funcoes 03/04, somente leitura).
                            Implementado direto sobre asyncio: o protocolo e pequeno (cabecalho MBAP + PDU).
  * `MeterUpdater`          gera as leituras (carga do predio pela curva do dia + carga dos carros no banco)
                            e escreve nos registradores.
  * `MeterPoller`           le os registradores pela rede com o cliente MODBUS do `pymodbus` (uma
                            implementacao independente da nossa) e guarda a ultima leitura. Com um medidor
                            FISICO so mudam host/porta/mapa: este leitor e o mesmo.

MAPA DE REGISTRADORES (ASSUMIDO -- ate haver o manual do medidor real; estilo "float32 em 2 registradores"):
  registradores de entrada (funcao 04) ou de retencao (funcao 03); endereco 0-based; unit id = MODBUS_UNIT_ID
  0-1 tensao L1 (V)   2-3 tensao L2   4-5 tensao L3      6-7 corrente L1 (A)   8-9 L2   10-11 L3
  12-13 potencia ativa total (W)      14-15 frequencia (Hz)      16-17 energia importada (kWh, acumulada)
Cada valor e um float32 IEEE-754 big-endian ocupando 2 registradores de 16 bits (palavra alta primeiro).
"""

import asyncio
import logging
import random
import struct
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from pymodbus.client import AsyncModbusTcpClient

from app.config import settings
from app.services import forecast
from app.services.ocpp_csms import run_db
from app.timeutil import local_hour

logger = logging.getLogger("chargegrid.modbus")

# (endereco, nome, unidade)
REGISTER_MAP = [
    (0, "voltage_l1_v", "V"),
    (2, "voltage_l2_v", "V"),
    (4, "voltage_l3_v", "V"),
    (6, "current_l1_a", "A"),
    (8, "current_l2_a", "A"),
    (10, "current_l3_a", "A"),
    (12, "active_power_w", "W"),
    (14, "frequency_hz", "Hz"),
    (16, "import_energy_kwh", "kWh"),
]
REGISTER_COUNT = 18  # 9 valores x 2 registradores
FRESH_SECONDS = 10  # leitura mais velha que isto nao e usada pelo balanceamento


# ---------------------------------------------------------------- codificacao float32 <-> 2 registradores
def encode_float(value: float) -> tuple[int, int]:
    high, low = struct.unpack(">HH", struct.pack(">f", value))
    return high, low


def decode_float(high: int, low: int) -> float:
    return struct.unpack(">f", struct.pack(">HH", high, low))[0]


def decode_registers(registers: list[int]) -> dict[str, float]:
    return {name: round(decode_float(registers[addr], registers[addr + 1]), 3) for addr, name, _unit in REGISTER_MAP}


# ---------------------------------------------------------------- servidor MODBUS TCP (o "medidor")
class SimulatedMeterServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 5020, unit_id: int = 1):
        self.host, self.port, self.unit_id = host, port, unit_id
        self.registers: list[int] = [0] * REGISTER_COUNT
        self._server: asyncio.Server | None = None
        self._writers: set[asyncio.StreamWriter] = set()  # conexoes abertas (fechadas em stop())

    def set_values(self, values: dict[str, float]) -> None:
        for addr, name, _unit in REGISTER_MAP:
            if name in values:
                self.registers[addr], self.registers[addr + 1] = encode_float(values[name])

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle, self.host, self.port)
        self.port = self._server.sockets[0].getsockname()[1]  # util quando a porta pedida foi 0

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            for writer in list(self._writers):  # sem isto o wait_closed() espera os clientes desconectarem (Python 3.12+)
                writer.close()
            await asyncio.wait_for(self._server.wait_closed(), timeout=5)

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._writers.add(writer)
        try:
            while True:
                header = await reader.readexactly(7)  # MBAP: transacao(2) protocolo(2) tamanho(2) unit id(1)
                transaction, protocol, length, unit = struct.unpack(">HHHB", header)
                if protocol != 0 or not 2 <= length <= 254:
                    break  # quadro invalido: fecha a conexao
                pdu = await reader.readexactly(length - 1)
                response = self._respond(unit, pdu)
                if response is None:
                    continue  # unit id de outro dispositivo: o MODBUS TCP nao responde
                writer.write(struct.pack(">HHHB", transaction, 0, len(response) + 1, unit) + response)
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            self._writers.discard(writer)
            writer.close()

    def _respond(self, unit: int, pdu: bytes) -> bytes | None:
        if unit != self.unit_id:
            return None
        function = pdu[0]
        if function in (3, 4) and len(pdu) == 5:  # ler registradores de retencao / de entrada
            address, quantity = struct.unpack(">HH", pdu[1:5])
            if not 1 <= quantity <= 125:
                return bytes([function | 0x80, 3])  # ILLEGAL DATA VALUE
            if address + quantity > len(self.registers):
                return bytes([function | 0x80, 2])  # ILLEGAL DATA ADDRESS
            data = b"".join(struct.pack(">H", word) for word in self.registers[address : address + quantity])
            return bytes([function, len(data)]) + data
        return bytes([function | 0x80, 1])  # ILLEGAL FUNCTION (medidor somente leitura)


# ---------------------------------------------------------------- geracao das leituras
def simulate_reading(hour: float, ev_load_kw: float, energy_kwh: float, dt_s: float, rng: random.Random) -> dict[str, float]:
    """Leitura do medidor do local: predio (segue a curva do dia) + carros; a energia acumula."""
    building_kw = settings.site_base_load_kw * (0.90 + 0.20 * forecast.hourly_shape(hour)) + rng.uniform(-1.5, 1.5)
    total_kw = max(0.0, building_kw + ev_load_kw)
    voltage = 127 + rng.uniform(-1.0, 1.0)
    current = total_kw * 1000 / (3 * voltage)
    return {
        "voltage_l1_v": voltage,
        "voltage_l2_v": voltage + rng.uniform(-0.5, 0.5),
        "voltage_l3_v": voltage + rng.uniform(-0.5, 0.5),
        "current_l1_a": current * rng.uniform(0.98, 1.02),
        "current_l2_a": current * rng.uniform(0.98, 1.02),
        "current_l3_a": current * rng.uniform(0.98, 1.02),
        "active_power_w": total_kw * 1000,
        "frequency_hz": 60 + rng.uniform(-0.05, 0.05),
        "import_energy_kwh": energy_kwh + total_kw * dt_s / 3600,
    }


class MeterUpdater:
    """Atualiza os registradores do medidor simulado a cada segundo."""

    def __init__(self, server: SimulatedMeterServer, interval_s: float = 1.0):
        self.server, self.interval_s = server, interval_s
        self.energy_kwh = 15_000.0  # contador acumulado (arbitrario)
        self.rng = random.Random()

    async def run(self) -> None:
        last = time.monotonic()
        while True:
            now = time.monotonic()
            try:
                ev_kw = await run_db(forecast.active_ev_load_kw)
            except Exception:  # noqa: BLE001 - banco indisponivel: mede so o predio
                ev_kw = 0.0
            values = simulate_reading(local_hour(), ev_kw, self.energy_kwh, now - last, self.rng)
            self.energy_kwh = values["import_energy_kwh"]
            self.server.set_values(values)
            last = now
            await asyncio.sleep(self.interval_s)


# ---------------------------------------------------------------- leitor (cliente MODBUS)
@dataclass
class MeterState:
    reading: dict[str, float] | None = None
    read_at: float | None = None  # monotonic
    read_at_utc: datetime | None = None
    error: str | None = None

    def age_s(self) -> float | None:
        return None if self.read_at is None else time.monotonic() - self.read_at


state = MeterState()


def fresh_reading() -> dict[str, float] | None:
    """Ultima leitura, se for recente (senao None e o balanceamento usa o cenario de referencia)."""
    age = state.age_s()
    return state.reading if state.reading is not None and age is not None and age <= FRESH_SECONDS else None


class MeterPoller:
    def __init__(self, host: str, port: int, unit_id: int, interval_s: float = 2.0):
        self.host, self.port, self.unit_id, self.interval_s = host, port, unit_id, interval_s

    async def read_once(self, client: AsyncModbusTcpClient) -> dict[str, float]:
        result = await client.read_input_registers(0, count=REGISTER_COUNT, device_id=self.unit_id)
        if result.isError():
            raise RuntimeError(f"MODBUS respondeu erro: {result}")
        return decode_registers(list(result.registers))

    async def run(self) -> None:
        client = AsyncModbusTcpClient(self.host, port=self.port, timeout=3)
        try:
            while True:
                try:
                    if not client.connected:
                        await client.connect()
                    state.reading = await self.read_once(client)
                    state.read_at, state.read_at_utc, state.error = time.monotonic(), datetime.now(UTC), None
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 - medidor fora do ar: guarda o erro e tenta de novo
                    state.error = f"{type(exc).__name__}: {exc}"[:200]
                    logger.warning("Falha ao ler o medidor MODBUS: %s", state.error)
                await asyncio.sleep(self.interval_s)
        finally:
            client.close()


async def start_meter_simulator() -> tuple[list[asyncio.Task], SimulatedMeterServer]:
    """Sobe o medidor virtual + o leitor (chamado no lifespan quando MODBUS_SIMULATOR=true)."""
    server = SimulatedMeterServer(settings.modbus_host, settings.modbus_port, settings.modbus_unit_id)
    await server.start()
    poller = MeterPoller(settings.modbus_host, server.port, settings.modbus_unit_id)
    tasks = [
        asyncio.create_task(MeterUpdater(server).run(), name="modbus-updater"),
        asyncio.create_task(poller.run(), name="modbus-poller"),
    ]
    return tasks, server

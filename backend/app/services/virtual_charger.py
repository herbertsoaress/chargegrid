"""Carregador VIRTUAL: hardware simulado que fala OCPP 1.6J de verdade com o backend.

Faz o papel do EV Charger FIAP enquanto nao ha equipamento fisico. E um cliente OCPP comum: conecta em
ws://.../ocpp/<codigo>, manda BootNotification, StatusNotification, Heartbeat e, quando o motorista
pre-autoriza o pagamento no app, executa Authorize -> StartTransaction -> MeterValues -> StopTransaction.
Quando o carregador FISICO chegar, ele fala exatamente este mesmo protocolo: so o endereco muda.

O que e SIMULADO aqui (e sempre declarado como tal): a energia entregue (potencia x tempo acelerado por
OCPP_SIMULATOR_SPEEDUP) e o cabo/RFID (a "presenca" do motorista vem do estado da sessao no banco).
"""

import asyncio
import base64
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import websockets
from ocpp.v16 import ChargePoint as OcppChargePoint
from ocpp.v16 import call

from app.config import settings
from app.models import Charger
from app.services import ocpp_service
from app.services.ocpp_csms import SUBPROTOCOL, run_db
from app.services.simulator import BATTERY_KWH

logger = logging.getLogger("chargegrid.ocpp.virtual")

VENDOR = "ChargeGrid Sim"  # OCPP 1.6 limita o fabricante a 20 caracteres
MODEL = "Virtual AC 22"


def _iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class Transaction:
    session_id: int
    transaction_id: int
    started_at: float  # monotonic
    power_kw: float
    start_soc: float
    last_meter_at: float
    energy_wh: float = 0.0


class VirtualCharger:
    def __init__(
        self,
        code: str,
        *,
        url: str | None = None,
        speedup: float | None = None,
        meter_interval_s: float | None = None,
        poll_s: float | None = None,
    ):
        self.code = code
        self.url = (url or settings.ocpp_simulator_url).rstrip("/")
        self.speedup = speedup if speedup is not None else settings.ocpp_simulator_speedup
        self.meter_interval_s = meter_interval_s if meter_interval_s is not None else settings.ocpp_simulator_meter_interval_s
        self.poll_s = poll_s if poll_s is not None else settings.ocpp_simulator_poll_s
        self.tx: Transaction | None = None
        self.reported_status: str | None = None
        self.retry_start_after = 0.0
        self.last_heartbeat = 0.0

    # ---------------------------------------------------------------- conexao
    async def run_forever(self) -> None:
        """Fica conectado; se o servidor cair ou ainda nao estiver de pe, tenta de novo."""
        headers = {}
        if settings.ocpp_shared_token:
            headers["Authorization"] = "Basic " + base64.b64encode(f"{self.code}:{settings.ocpp_shared_token}".encode()).decode()
        while True:
            try:
                async with websockets.connect(
                    f"{self.url}/ocpp/{self.code}", subprotocols=[SUBPROTOCOL], additional_headers=headers, open_timeout=5
                ) as connection:
                    charge_point = OcppChargePoint(self.code, connection)
                    listener = asyncio.create_task(charge_point.start())
                    try:
                        await self.run(charge_point)
                    finally:
                        listener.cancel()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - qualquer falha: espera e reconecta
                logger.warning("Carregador virtual %s desconectado (%s: %s); tentando de novo", self.code, type(exc).__name__, exc)
            self.tx, self.reported_status = None, None  # a proxima conexao recomeca do zero
            await asyncio.sleep(3)

    async def run(self, charge_point) -> None:
        await charge_point.call(call.BootNotification(charge_point_model=MODEL, charge_point_vendor=VENDOR))
        while True:
            snapshot = await run_db(ocpp_service.charger_snapshot, self.code)
            await self.step(charge_point, snapshot, time.monotonic())
            await asyncio.sleep(self.poll_s)

    # ---------------------------------------------------------------- maquina de estados do carregador
    async def step(self, cp, snapshot: dict | None, now: float) -> None:
        """Um passo: olha o banco (snapshot) e decide o que dizer ao CSMS. Separado da rede para poder ser testado."""
        session = snapshot["session"] if snapshot else None
        maintenance = bool(snapshot) and snapshot["charger_status"] == "manutencao"

        if now - self.last_heartbeat >= settings.ocpp_heartbeat_interval:
            self.last_heartbeat = now
            await cp.call(call.Heartbeat())

        # 1) transacao em andamento mas a sessao acabou (o app pagou e encerrou): StopTransaction
        if self.tx and (session is None or session["id"] != self.tx.session_id):
            await self._finish(cp)

        # 2) sem transacao: mantem o status certo e espera um motorista pre-autorizado
        if self.tx is None:
            desired = "Unavailable" if maintenance else "Available"
            if session is None and self.reported_status != desired:
                await self._status(cp, desired)
            elif session and session["payment_confirmed"] and not session["rfid_ok"] and not maintenance:
                if now >= self.retry_start_after:
                    await self._begin(cp, session, now)

        # 3) transacao em andamento: leitura periodica do medidor
        if self.tx and now - self.tx.last_meter_at >= self.meter_interval_s:
            await self._meter(cp, now)

    async def _status(self, cp, status: str) -> None:
        error = "OtherError" if status == "Unavailable" else "NoError"
        await cp.call(call.StatusNotification(connector_id=1, error_code=error, status=status))
        self.reported_status = status

    async def _begin(self, cp, session: dict, now: float) -> None:
        id_tag = ocpp_service.id_tag_for_user(session["user_id"])
        await self._status(cp, "Preparing")  # motorista chegou (cabo/RFID simulados)
        authorized = await cp.call(call.Authorize(id_tag=id_tag))
        if authorized.id_tag_info["status"] != "Accepted":
            self.retry_start_after = now + 5
            return
        started = await cp.call(
            call.StartTransaction(connector_id=1, id_tag=id_tag, meter_start=0, timestamp=_iso())
        )
        if started.id_tag_info["status"] != "Accepted":
            self.retry_start_after = now + 5  # ex.: Blocked (pagamento nao pre-autorizado): tenta de novo
            return
        self.tx = Transaction(
            session_id=session["id"],
            transaction_id=started.transaction_id,
            started_at=now,
            power_kw=session["nominal_power_kw"],
            start_soc=session["current_pct"],
            last_meter_at=now,
        )
        await self._status(cp, "Charging")

    def _reading(self, now: float) -> tuple[float, float, float]:
        """(energia Wh, potencia W, SoC %) da recarga simulada: potencia x tempo acelerado, limitada a bateria cheia."""
        assert self.tx is not None
        elapsed_sim_s = (now - self.tx.started_at) * self.speedup
        energy_kwh = self.tx.power_kw * elapsed_sim_s / 3600
        room_kwh = max(0.0, (100 - self.tx.start_soc) / 100 * BATTERY_KWH)
        full = energy_kwh >= room_kwh
        energy_kwh = min(energy_kwh, room_kwh)
        soc = min(100.0, self.tx.start_soc + energy_kwh / BATTERY_KWH * 100)
        return energy_kwh * 1000, 0.0 if full else self.tx.power_kw * 1000, soc

    async def _meter(self, cp, now: float) -> None:
        assert self.tx is not None
        energy_wh, power_w, soc = self._reading(now)
        self.tx.energy_wh, self.tx.last_meter_at = energy_wh, now
        await cp.call(
            call.MeterValues(
                connector_id=1,
                transaction_id=self.tx.transaction_id,
                meter_value=[
                    {
                        "timestamp": _iso(),
                        "sampled_value": [
                            {"value": f"{energy_wh:.0f}", "context": "Sample.Periodic",
                             "measurand": "Energy.Active.Import.Register", "unit": "Wh"},
                            {"value": f"{power_w:.0f}", "context": "Sample.Periodic",
                             "measurand": "Power.Active.Import", "unit": "W"},
                            {"value": f"{soc:.1f}", "context": "Sample.Periodic", "measurand": "SoC", "unit": "Percent"},
                        ],
                    }
                ],
            )
        )

    async def _finish(self, cp) -> None:
        assert self.tx is not None
        tx, self.tx = self.tx, None
        await cp.call(
            call.StopTransaction(transaction_id=tx.transaction_id, meter_stop=int(tx.energy_wh), timestamp=_iso(), reason="Local")
        )
        await self._status(cp, "Finishing")
        await self._status(cp, "Available")


async def start_virtual_chargers() -> list[asyncio.Task]:
    """Sobe um carregador virtual para cada carregador cadastrado (chamado no lifespan quando OCPP_SIMULATOR=true)."""
    codes = await run_db(lambda db: [c.code for c in db.query(Charger).order_by(Charger.code)])
    return [asyncio.create_task(VirtualCharger(code).run_forever(), name=f"virtual-{code}") for code in codes]

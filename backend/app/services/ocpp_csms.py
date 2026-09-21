"""Transporte OCPP 1.6J (WebSocket): o backend como CSMS (sistema central de gestao de carregadores).

Um carregador conecta em  ws://HOST/ocpp/<codigo>  (ex.: CG-001) pedindo o subprotocolo "ocpp1.6", e troca
mensagens JSON [tipo, id, acao, payload]. A biblioteca `ocpp` valida cada mensagem contra o esquema oficial
do OCPP 1.6 e roteia para os handlers abaixo, que chamam as regras de negocio de `ocpp_service.py`.

  * O acesso ao banco roda em thread (`run_db`) para nao travar o loop de eventos.
  * TODO quadro (entrada e saida) e gravado em `ocpp_messages` -> tela "Logs OCPP".
  * Senha opcional (OCPP_SHARED_TOKEN, HTTP Basic com o codigo do carregador como usuario).
"""

import asyncio
import base64
import logging
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from ocpp.routing import on
from ocpp.v16 import ChargePoint as OcppChargePoint
from ocpp.v16 import call_result
from ocpp.v16.enums import Action, RegistrationStatus
from sqlalchemy.orm import Session as DbSession

from app import db as db_module
from app.config import settings
from app.services import ocpp_service

logger = logging.getLogger("chargegrid.ocpp")

SUBPROTOCOL = "ocpp1.6"

# Fabrica de sessoes de banco usada pelos handlers (os testes trocam por um banco em arquivo).
_session_factory: Callable[[], DbSession] | None = None


def set_session_factory(factory: Callable[[], DbSession] | None) -> None:
    global _session_factory
    _session_factory = factory


async def run_db(fn: Callable[..., Any], *args: Any) -> Any:
    """Executa `fn(db, *args)` numa thread com uma sessao de banco propria."""

    def job() -> Any:
        db = (_session_factory or db_module.SessionLocal)()
        try:
            return fn(db, *args)
        finally:
            db.close()

    return await asyncio.to_thread(job)


@dataclass
class ConnectedChargePoint:
    code: str
    connected_at: datetime
    last_message_at: datetime
    vendor: str = ""
    model: str = ""


connected: dict[str, ConnectedChargePoint] = {}  # quem esta conectado agora


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _value(x: Any) -> Any:
    return getattr(x, "value", x)  # enum -> texto


class WebSocketConnection:
    """Liga o WebSocket do FastAPI ao que a biblioteca `ocpp` espera (recv/send) e registra cada quadro."""

    def __init__(self, websocket: WebSocket, info: ConnectedChargePoint):
        self.websocket = websocket
        self.info = info
        self.pending: dict[str, str] = {}  # id do CALL -> acao (para nomear o CALLRESULT no log)

    async def recv(self) -> str:
        raw = await self.websocket.receive_text()
        self.info.last_message_at = datetime.now(UTC)
        await run_db(ocpp_service.log_frame, self.info.code, "in", raw, self.pending)
        return raw

    async def send(self, message: str) -> None:
        await run_db(ocpp_service.log_frame, self.info.code, "out", message, self.pending)
        await self.websocket.send_text(message)


class CsmsChargePoint(OcppChargePoint):
    def __init__(self, code: str, connection: WebSocketConnection):
        super().__init__(code, connection)
        self.info = connection.info

    @on(Action.boot_notification)
    async def on_boot_notification(self, charge_point_vendor, charge_point_model, **kwargs):
        self.info.vendor, self.info.model = charge_point_vendor, charge_point_model
        await run_db(ocpp_service.on_boot, self.id, charge_point_vendor, charge_point_model, kwargs.get("firmware_version"))
        return call_result.BootNotification(
            current_time=_now_iso(), interval=settings.ocpp_heartbeat_interval, status=RegistrationStatus.accepted
        )

    @on(Action.heartbeat)
    async def on_heartbeat(self):
        return call_result.Heartbeat(current_time=_now_iso())

    @on(Action.status_notification)
    async def on_status_notification(self, connector_id, error_code, status, **kwargs):
        await run_db(ocpp_service.on_status, self.id, connector_id, _value(status), _value(error_code))
        return call_result.StatusNotification()

    @on(Action.authorize)
    async def on_authorize(self, id_tag, **kwargs):
        status = await run_db(ocpp_service.on_authorize, id_tag)
        return call_result.Authorize(id_tag_info={"status": status})

    @on(Action.start_transaction)
    async def on_start_transaction(self, connector_id, id_tag, meter_start, timestamp, **kwargs):
        transaction_id, status = await run_db(ocpp_service.on_start, self.id, id_tag, meter_start, connector_id)
        return call_result.StartTransaction(transaction_id=transaction_id, id_tag_info={"status": status})

    @on(Action.meter_values)
    async def on_meter_values(self, connector_id, meter_value, **kwargs):
        await run_db(ocpp_service.on_meter, self.id, kwargs.get("transaction_id"), meter_value)
        return call_result.MeterValues()

    @on(Action.stop_transaction)
    async def on_stop_transaction(self, meter_stop, timestamp, transaction_id, **kwargs):
        await run_db(ocpp_service.on_stop, self.id, transaction_id, meter_stop, _value(kwargs.get("reason")))
        return call_result.StopTransaction(id_tag_info={"status": "Accepted"})


def _authorized(websocket: WebSocket, code: str) -> bool:
    """Sem OCPP_SHARED_TOKEN qualquer carregador cadastrado entra; com ele exige HTTP Basic (usuario = codigo)."""
    token = settings.ocpp_shared_token
    if not token:
        return True
    header = websocket.headers.get("authorization", "")
    if not header.lower().startswith("basic "):
        return False
    try:
        user, _, password = base64.b64decode(header[6:]).decode().partition(":")
    except (ValueError, UnicodeDecodeError):
        return False
    return secrets.compare_digest(user, code) and secrets.compare_digest(password, token)


async def serve_charge_point(websocket: WebSocket, code: str) -> None:
    """Atende UM carregador ate ele desconectar."""
    requested = [p.strip() for p in websocket.headers.get("sec-websocket-protocol", "").split(",")]
    if not settings.ocpp_enabled or SUBPROTOCOL not in requested or not _authorized(websocket, code):
        await websocket.close(code=1008)  # recusa o handshake (politica)
        return
    if not await run_db(lambda db: ocpp_service.get_charger(db, code) is not None):
        await websocket.close(code=1008)  # carregador nao cadastrado
        return

    await websocket.accept(subprotocol=SUBPROTOCOL)
    now = datetime.now(UTC)
    info = ConnectedChargePoint(code=code, connected_at=now, last_message_at=now)
    connected[code] = info
    charge_point = CsmsChargePoint(code, WebSocketConnection(websocket, info))
    try:
        await charge_point.start()
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - um carregador com problema nao pode derrubar o servidor
        logger.exception("Falha na conexao OCPP de %s", code)
    finally:
        if connected.get(code) is info:
            del connected[code]

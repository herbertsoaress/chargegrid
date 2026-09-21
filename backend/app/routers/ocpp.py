"""OCPP 1.6J: o endpoint dos carregadores (WebSocket) e as consultas do operador.

  WS   /ocpp/{codigo}       carregador conecta aqui (subprotocolo "ocpp1.6"), ex.: ws://localhost:8000/ocpp/CG-001
  GET  /ocpp/status         operador: quem esta conectado, se ha senha, se o simulador esta ligado
  GET  /ocpp/messages       operador: ultimas mensagens OCPP (tela "Logs OCPP")
"""

from fastapi import APIRouter, Depends, Query, WebSocket
from sqlalchemy.orm import Session as DbSession

from app.config import settings
from app.db import get_db
from app.models import OcppMessage, User
from app.schemas import OcppConnectedOut, OcppMessageOut, OcppStatusOut
from app.security import require_operator
from app.services import ocpp_csms

router = APIRouter(tags=["ocpp"])


@router.websocket("/ocpp/{charge_point_id}")
async def ocpp_endpoint(websocket: WebSocket, charge_point_id: str):
    await ocpp_csms.serve_charge_point(websocket, charge_point_id)


@router.get("/ocpp/status", response_model=OcppStatusOut)
def ocpp_status(_operator: User = Depends(require_operator)):
    return OcppStatusOut(
        enabled=settings.ocpp_enabled,
        auth_required=bool(settings.ocpp_shared_token),
        simulator=settings.ocpp_simulator,
        protocol="OCPP 1.6J",
        connected=[
            OcppConnectedOut(
                code=c.code,
                connected_at=c.connected_at.replace(tzinfo=None),
                last_message_at=c.last_message_at.replace(tzinfo=None),
                vendor=c.vendor,
                model=c.model,
            )
            for c in sorted(ocpp_csms.connected.values(), key=lambda c: c.code)
        ],
    )


@router.get("/ocpp/messages", response_model=list[OcppMessageOut])
def ocpp_messages(
    limit: int = Query(default=100, ge=1, le=500),
    charger: str | None = Query(default=None, max_length=20),
    db: DbSession = Depends(get_db),
    _operator: User = Depends(require_operator),
):
    query = db.query(OcppMessage)
    if charger:
        query = query.filter(OcppMessage.charge_point_id == charger)
    return query.order_by(OcppMessage.id.desc()).limit(limit).all()

"""Acoes operacionais do console: peak shaving e leitura do medidor MODBUS."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User
from app.schemas import MeterOut, MeterRegisterOut, PeakShavingRequest
from app.security import require_operator
from app.services import modbus_meter
from app.services.integration_log import log_integration

router = APIRouter(prefix="/ops", tags=["ops"])


@router.post("/peak-shaving")
def apply_peak_shaving(
    payload: PeakShavingRequest,
    db: Session = Depends(get_db),
    operator: User = Depends(require_operator),
):
    """Registra na trilha de auditoria que o operador acionou o peak shaving.

    A reducao de potencia em si e simulada no console; aqui fica a evidencia
    (quem, quando, quanto) para auditoria -- nada e enviado a equipamento real.
    """
    entry = log_integration(
        db,
        "load-balancer",
        "WARN",
        f"PeakShaving acionado por {operator.email}: -{payload.reduction_pct}% por {payload.duration_s}s",
        {"reduction_pct": payload.reduction_pct, "duration_s": payload.duration_s, "simulado": True},
    )
    return {"logged": True, "log_id": entry.id}


@router.get("/meter", response_model=MeterOut)
def read_meter(_operator: User = Depends(require_operator)):
    """Ultima leitura do medidor de energia (MODBUS TCP). Hoje o medidor e SIMULADO (origem sempre informada)."""
    return MeterOut(
        enabled=settings.modbus_simulator,
        protocol="MODBUS TCP",
        origem="simulado",
        host=settings.modbus_host,
        port=settings.modbus_port,
        unit_id=settings.modbus_unit_id,
        register_map=[MeterRegisterOut(address=a, name=n, unit=u) for a, n, u in modbus_meter.REGISTER_MAP],
        reading=modbus_meter.state.reading,
        read_at=modbus_meter.state.read_at_utc.replace(tzinfo=None) if modbus_meter.state.read_at_utc else None,
        age_s=None if modbus_meter.state.age_s() is None else round(modbus_meter.state.age_s(), 1),
        fresh=modbus_meter.fresh_reading() is not None,
        error=modbus_meter.state.error,
    )

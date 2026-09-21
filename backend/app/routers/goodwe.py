from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import IntegrationLog, User
from app.schemas import GoodWeDevice, GoodWePlant, GoodWeStatus, IntegrationLogOut
from app.security import require_operator
from app.services.goodwe_adapter import get_adapter
from app.services.goodwe_service import call_adapter

router = APIRouter(prefix="/goodwe", tags=["goodwe"])


@router.get("/status", response_model=GoodWeStatus)
def goodwe_status():
    """Publico: diz se a integracao esta simulada ou real. Nao expoe segredos."""
    return get_adapter().get_status()


@router.get("/plants", response_model=list[GoodWePlant])
def goodwe_plants(db: Session = Depends(get_db), _operator: User = Depends(require_operator)):
    return call_adapter(db, "listar usinas", lambda: get_adapter().list_plants())


@router.get("/devices", response_model=list[GoodWeDevice])
def goodwe_devices(
    plant_id: str | None = None, db: Session = Depends(get_db), _operator: User = Depends(require_operator)
):
    return call_adapter(db, "listar dispositivos", lambda: get_adapter().list_devices(plant_id))


@router.get("/logs", response_model=list[IntegrationLogOut])
def integration_logs(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _operator: User = Depends(require_operator),
):
    """Trilha de auditoria das integracoes (erros da GoodWe, peak shaving...)."""
    return db.query(IntegrationLog).order_by(IntegrationLog.id.desc()).limit(limit).all()

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.config import settings
from app.db import get_db
from app.services import ocpp_csms, payments
from app.services.goodwe_adapter import get_adapter

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """Endpoint de saude (Etapa 1): confirma que a API responde E que o banco esta acessivel."""
    try:
        db.execute(text("select 1"))
        database = {"ok": True, "engine": db.get_bind().dialect.name}
    except Exception as exc:  # noqa: BLE001 - qualquer falha de banco significa "degradado"
        database = {"ok": False, "engine": db.get_bind().dialect.name, "error": type(exc).__name__}

    try:
        provider = payments.get_provider()
        payment_info = {"provider": provider.name, "real": provider.real}
    except payments.PaymentConfigError:
        payment_info = {"provider": settings.payment_provider, "real": False, "error": "provedor desconhecido"}

    body = {
        "status": "ok" if database["ok"] else "degraded",
        "version": __version__,
        "env": settings.app_env,
        "database": database,
        "goodwe": {"origem": get_adapter().origem},
        "payments": payment_info,
        # carregadores falam OCPP 1.6J com o backend; "simulator" = carregadores virtuais ligados (hardware simulado)
        "ocpp": {
            "enabled": settings.ocpp_enabled,
            "simulator": settings.ocpp_simulator,
            "connected": len(ocpp_csms.connected),
        },
        "modbus": {"simulator": settings.modbus_simulator},
        # o app so mostra "Entrar como demonstracao" quando isto e true (desligue em producao)
        "demo_login": settings.allow_demo_login,
    }
    return JSONResponse(body, status_code=200 if database["ok"] else 503)

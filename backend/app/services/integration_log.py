from sqlalchemy.orm import Session

from app.models import IntegrationLog


def log_integration(
    db: Session,
    source: str,
    level: str,
    message: str,
    payload: dict | None = None,
) -> IntegrationLog:
    """Grava uma linha na trilha de auditoria de integracoes e confirma a transacao."""
    entry = IntegrationLog(source=source, level=level, message=message[:500], payload_json=payload or {})
    db.add(entry)
    db.commit()
    return entry

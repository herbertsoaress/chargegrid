from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import SessionEvent, User
from app.schemas import EventOut
from app.security import require_operator

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[EventOut])
def recent_events(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _operator: User = Depends(require_operator),
):
    """Ultimos eventos de todas as sessoes (base da tela 'Logs OCPP' com dados persistidos)."""
    events = db.query(SessionEvent).order_by(SessionEvent.id.desc()).limit(limit).all()
    return [
        EventOut(
            id=e.id,
            session_id=e.session_id,
            charger_code=e.session.charger.code,
            type=e.type,
            payload_json=e.payload_json,
            created_at=e.created_at,
        )
        for e in events
    ]

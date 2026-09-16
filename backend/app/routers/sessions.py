from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import Charger, ChargerStatus, ChargingSession, Payment, PaymentStatus, Role, SessionMode, User
from app.schemas import PayRequest, PaymentOut, SessionCreateRequest, SessionEventOut, SessionOut
from app.security import get_current_user
from app.services import session_fsm
from app.services.pricing import price_per_kwh

router = APIRouter(prefix="/sessions", tags=["sessions"])

MODE_FACTOR = {
    SessionMode.rapido: 1.0,
    SessionMode.economico: 0.55,
    SessionMode.sustentavel: 0.75,
}


def _log_event(db: DbSession, session: ChargingSession, event_type: str, payload: dict):
    from app.models import SessionEvent

    db.add(SessionEvent(session_id=session.id, type=event_type, payload_json=payload))


def _get_session_or_404(db: DbSession, session_id: int) -> ChargingSession:
    session = db.get(ChargingSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessao nao encontrada")
    return session


@router.post("", response_model=SessionOut)
def create_session(
    payload: SessionCreateRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    charger = db.get(Charger, payload.charger_id)
    if not charger:
        raise HTTPException(status_code=404, detail="Carregador nao encontrado")
    if charger.status != ChargerStatus.livre:
        raise HTTPException(status_code=409, detail="Carregador indisponivel")

    now = datetime.utcnow()
    price = price_per_kwh(charger.station.type, now.hour + now.minute / 60)

    session = ChargingSession(
        user_id=user.id,
        vehicle_id=payload.vehicle_id,
        charger_id=charger.id,
        mode=payload.mode,
        price_per_kwh_snapshot=price,
    )
    charger.status = ChargerStatus.ocupado
    db.add(session)
    db.flush()
    _log_event(db, session, "session_created", {"charger_id": charger.id, "mode": payload.mode.value})
    db.commit()
    db.refresh(session)
    return session


@router.get("", response_model=list[SessionOut])
def list_sessions(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    query = db.query(ChargingSession)
    if user.role != Role.operator:
        query = query.filter(ChargingSession.user_id == user.id)
    return query.order_by(ChargingSession.started_at.desc()).all()


@router.get("/{session_id}", response_model=SessionOut)
def get_session(session_id: int, db: DbSession = Depends(get_db)):
    return _get_session_or_404(db, session_id)


@router.get("/{session_id}/events", response_model=list[SessionEventOut])
def get_session_events(session_id: int, db: DbSession = Depends(get_db)):
    session = _get_session_or_404(db, session_id)
    return session.events


@router.post("/{session_id}/confirm-payment", response_model=SessionOut)
def confirm_payment(session_id: int, db: DbSession = Depends(get_db)):
    session = _get_session_or_404(db, session_id)
    session.payment_confirmed = True
    result = session_fsm.confirm_payment()
    _log_event(db, session, result.event_type, result.payload)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/authenticate-rfid", response_model=SessionOut)
def authenticate_rfid(session_id: int, approved: bool = True, db: DbSession = Depends(get_db)):
    session = _get_session_or_404(db, session_id)
    session.rfid_ok = approved
    result = session_fsm.authenticate_rfid(approved)
    _log_event(db, session, result.event_type, result.payload)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/connect-cable", response_model=SessionOut)
def connect_cable(session_id: int, db: DbSession = Depends(get_db)):
    session = _get_session_or_404(db, session_id)
    if not (session.payment_confirmed and session.rfid_ok):
        raise HTTPException(
            status_code=409,
            detail="Pagamento e autenticacao RFID precisam estar confirmados antes de engatar o cabo",
        )
    session.cable_connected = True
    result = session_fsm.connect_cable()
    _log_event(db, session, result.event_type, result.payload)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/maintenance-bypass", response_model=SessionOut)
def maintenance_bypass(session_id: int, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role != Role.operator:
        raise HTTPException(status_code=403, detail="Bypass de manutencao e restrito ao operador")
    session = _get_session_or_404(db, session_id)
    session.maintenance_bypass = True
    result = session_fsm.enable_maintenance_bypass()
    _log_event(db, session, result.event_type, result.payload)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/pay", response_model=PaymentOut)
def pay_session(session_id: int, payload: PayRequest, db: DbSession = Depends(get_db)):
    session = _get_session_or_404(db, session_id)
    if not session.power_released:
        raise HTTPException(status_code=409, detail="Energia ainda nao foi liberada para esta sessao")

    elapsed_hours = max((datetime.utcnow() - session.started_at).total_seconds() / 3600, 1 / 3600)
    factor = MODE_FACTOR[session.mode]
    energy_kwh = round(session.charger.max_power_kw * factor * elapsed_hours, 3)
    amount_due = round(energy_kwh * session.price_per_kwh_snapshot, 2)
    session.energy_kwh = energy_kwh
    session.amount_due = amount_due

    # Pagamento em ambiente sandbox: aprovacao simulada instantanea (PIX/Cartao),
    # conforme a Etapa 4 da proposta de evolucao ("pagamento em ambiente de testes").
    payment = Payment(
        session_id=session.id,
        method=payload.method,
        status=PaymentStatus.aprovado,
        amount=amount_due,
        provider_ref=f"SANDBOX-{payload.method.value.upper()}-{session.id}",
    )
    db.add(payment)

    session.payment_finalized = True
    result = session_fsm.finalize_payment()
    _log_event(db, session, result.event_type, {**result.payload, "amount": amount_due, "method": payload.method.value})
    db.commit()
    db.refresh(payment)
    return payment


@router.post("/{session_id}/stop", response_model=SessionOut)
def stop_session(session_id: int, db: DbSession = Depends(get_db)):
    session = _get_session_or_404(db, session_id)
    if not session.lock_released:
        raise HTTPException(
            status_code=409,
            detail="Trava do cabo ainda bloqueada: finalize o pagamento (ou acione bypass de manutencao) antes de encerrar",
        )
    session.ended_at = datetime.utcnow()
    session.charger.status = ChargerStatus.livre
    _log_event(db, session, "session_stopped", {"energy_kwh": session.energy_kwh, "amount_due": session.amount_due})
    db.commit()
    db.refresh(session)
    return session

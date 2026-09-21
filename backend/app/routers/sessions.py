"""Sessoes de recarga: a jornada completa (Etapa 2) e o comprovante (Etapa 4).

Toda rota exige login e so deixa o DONO da sessao (ou um operador) mexer nela.
A ordem natural da jornada e:

  POST /sessions                      -> cria a sessao e reserva o carregador
  POST /sessions/{id}/confirm-payment -> A: pre-autorizacao do pagamento
  POST /sessions/{id}/authenticate-rfid -> B: RFID (hardware simulado)
  POST /sessions/{id}/connect-cable   -> C: cabo engatado => S=1, energia liberada
  POST /sessions/{id}/meter-values    -> telemetria (controlador simulado / carregador)
  POST /sessions/{id}/pay             -> D: pagamento sandbox => T=1, trava liberada
  POST /sessions/{id}/stop            -> encerra e libera o carregador
  GET  /sessions/{id}/receipt         -> comprovante
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DbSession

from app.config import settings
from app.db import get_db
from app.models import (
    Charger,
    ChargerStatus,
    ChargingSession,
    Payment,
    PaymentStatus,
    Role,
    User,
    Vehicle,
)
from app.schemas import (
    MeterValuesRequest,
    PaymentOut,
    PayRequest,
    ReceiptOut,
    SessionCreateRequest,
    SessionEventOut,
    SessionOut,
)
from app.security import get_current_user
from app.services import session_fsm, session_ops
from app.services.session_ops import SessionOpError
from app.services import forecast, payments, pricing
from app.services.simulator import (
    DEFAULT_START_PCT,
    live_energy_and_amount,
    nominal_power_kw,
    simulated_energy_kwh,
    soc_from_energy,
)
from app.timeutil import utcnow

router = APIRouter(prefix="/sessions", tags=["sessions"])

def _run(operation, *args, **kwargs):
    """Executa uma operacao de services/session_ops.py e traduz a recusa em HTTP 409."""
    try:
        return operation(*args, **kwargs)
    except SessionOpError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc


def receipt_number(session_id: int, when=None) -> str:
    year = (when or utcnow()).year
    return f"CG-{year}-{session_id:06d}"


_log_event = session_ops.log_event


def _get_session_for(db: DbSession, session_id: int, user: User) -> ChargingSession:
    """Sessao do proprio usuario (operador enxerga todas). 404 tambem quando nao e dono,
    para nao revelar que a sessao existe."""
    session = db.get(ChargingSession, session_id)
    if not session or (user.role != Role.operator and session.user_id != user.id):
        raise HTTPException(status_code=404, detail="Sessao nao encontrada")
    return session


def _expire_stale_sessions(db: DbSession, charger: Charger) -> None:
    """Fecha sessoes abandonadas (aba fechada, app encerrado) que estao prendendo o carregador."""
    limit = utcnow() - timedelta(minutes=settings.session_ttl_minutes)
    stale = (
        db.query(ChargingSession)
        .filter(
            ChargingSession.charger_id == charger.id,
            ChargingSession.ended_at.is_(None),
            ChargingSession.started_at < limit,
        )
        .all()
    )
    for s in stale:
        s.ended_at = utcnow()
        _log_event(db, s, "session_expired", {"motivo": f"sem atividade ha mais de {settings.session_ttl_minutes} min"})
    db.flush()  # a sessao esta com autoflush desligado: sem isto o count() abaixo ainda veria a sessao aberta
    if stale and not (
        db.query(ChargingSession)
        .filter(ChargingSession.charger_id == charger.id, ChargingSession.ended_at.is_(None))
        .count()
    ):
        charger.status = ChargerStatus.livre
    if stale:
        db.commit()


@router.post("", response_model=SessionOut)
def create_session(
    payload: SessionCreateRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    charger = db.get(Charger, payload.charger_id)
    if not charger:
        raise HTTPException(status_code=404, detail="Carregador nao encontrado")
    if payload.vehicle_id is not None:
        vehicle = db.get(Vehicle, payload.vehicle_id)
        if not vehicle or vehicle.user_id != user.id:  # so o dono pode usar o proprio veiculo
            raise HTTPException(status_code=404, detail="Veiculo nao encontrado")
    _expire_stale_sessions(db, charger)
    if charger.status != ChargerStatus.livre:
        raise HTTPException(status_code=409, detail="Carregador indisponivel")

    now = utcnow()
    # Preco do kWh travado na abertura: modelo de previsao + carga real da rede (services/pricing.py)
    quote = pricing.quote(now, live_occupancy=forecast.live_occupancy(db))
    session = ChargingSession(
        user_id=user.id,
        vehicle_id=payload.vehicle_id,
        charger_id=charger.id,
        mode=payload.mode,
        vehicle_label=payload.vehicle_label,
        target_pct=payload.target_pct,
        departure_time=payload.departure_time,
        current_pct=DEFAULT_START_PCT,
        price_per_kwh_snapshot=quote.price,
        price_source=quote.source,
        price_occupancy=quote.occupancy,
    )
    charger.status = ChargerStatus.ocupado
    db.add(session)
    db.flush()
    _log_event(
        db,
        session,
        "session_created",
        {
            "charger_id": charger.id,
            "mode": payload.mode.value,
            "price_per_kwh": quote.price,
            "price_source": quote.source,
            "occupancy": quote.occupancy,
        },
    )
    db.commit()
    db.refresh(session)
    return session


@router.get("", response_model=list[SessionOut])
def list_sessions(
    status: str | None = Query(default=None, pattern="^(active|completed)$"),
    limit: int = Query(default=100, ge=1, le=500),
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(ChargingSession)
    if user.role != Role.operator:
        query = query.filter(ChargingSession.user_id == user.id)
    if status == "active":
        query = query.filter(ChargingSession.ended_at.is_(None))
    elif status == "completed":
        query = query.filter(ChargingSession.ended_at.isnot(None))
    return query.order_by(ChargingSession.started_at.desc()).limit(limit).all()


@router.get("/{session_id}", response_model=SessionOut)
def get_session(session_id: int, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    return _get_session_for(db, session_id, user)


@router.get("/{session_id}/events", response_model=list[SessionEventOut])
def get_session_events(session_id: int, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    return _get_session_for(db, session_id, user).events


@router.post("/{session_id}/confirm-payment", response_model=SessionOut)
def confirm_payment(session_id: int, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    session = _get_session_for(db, session_id, user)
    if session.ended_at:
        raise HTTPException(status_code=409, detail="Sessao ja encerrada")
    session.payment_confirmed = True
    result = session_fsm.confirm_payment()
    _log_event(db, session, result.event_type, result.payload)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/authenticate-rfid", response_model=SessionOut)
def authenticate_rfid(
    session_id: int,
    approved: bool = True,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    session = _get_session_for(db, session_id, user)
    _run(session_ops.set_rfid, db, session, approved)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/connect-cable", response_model=SessionOut)
def connect_cable(session_id: int, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    session = _get_session_for(db, session_id, user)
    _run(session_ops.connect_cable, db, session)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/maintenance-bypass", response_model=SessionOut)
def maintenance_bypass(session_id: int, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role != Role.operator:
        raise HTTPException(status_code=403, detail="Bypass de manutencao e restrito ao operador")
    session = _get_session_for(db, session_id, user)
    if session.ended_at:
        raise HTTPException(status_code=409, detail="Sessao ja encerrada")
    session.maintenance_bypass = True
    if session.charging_started_at is None:
        session.charging_started_at = utcnow()
    result = session_fsm.enable_maintenance_bypass()
    _log_event(db, session, result.event_type, result.payload)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/meter-values", response_model=SessionOut)
def meter_values(
    session_id: int,
    payload: MeterValuesRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Recebe a telemetria do carregador (o controlador simulado do app ou o carregador via OCPP)."""
    session = _get_session_for(db, session_id, user)
    _run(session_ops.report_meter, db, session, payload.energy_kwh, payload.power_kw, payload.soc_pct)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/pay", response_model=PaymentOut)
def pay_session(
    session_id: int,
    payload: PayRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    session = _get_session_for(db, session_id, user)
    if session.ended_at:
        raise HTTPException(status_code=409, detail="Sessao ja encerrada")
    if session.payment_finalized:
        raise HTTPException(status_code=409, detail="Pagamento desta sessao ja foi realizado")
    if not session.power_released:
        raise HTTPException(status_code=409, detail="Energia ainda nao foi liberada para esta sessao")

    # Sem medidor reportado, usa o controlador simulado como fonte da energia.
    if session.last_meter_at is None:
        session.energy_kwh = simulated_energy_kwh(session)
        session.current_power_kw = nominal_power_kw(session)
        session.current_pct = soc_from_energy(session.energy_kwh)
    amount_due = round(session.energy_kwh * session.price_per_kwh_snapshot, 2)
    session.amount_due = amount_due

    # O provedor (hoje o sandbox: aprovacao simulada, sem cobranca real) decide o resultado.
    provider = payments.get_provider()
    outcome = provider.charge(session_id=session.id, method=payload.method, amount=amount_due)
    payment = Payment(
        session_id=session.id,
        method=payload.method,
        status=outcome.status,
        amount=amount_due,
        provider_ref=outcome.provider_ref,
    )
    db.add(payment)

    if outcome.status == PaymentStatus.aprovado:
        session.payment_finalized = True
        result = session_fsm.finalize_payment()
        _log_event(
            db,
            session,
            result.event_type,
            {**result.payload, "amount": amount_due, "method": payload.method.value, "provider": provider.name},
        )
    else:  # pendente/recusado: a sessao segue aberta e o motorista pode tentar de novo
        _log_event(
            db,
            session,
            "payment_" + outcome.status.value,
            {"amount": amount_due, "method": payload.method.value, "provider": provider.name},
        )
    db.commit()
    db.refresh(payment)
    if outcome.status == PaymentStatus.recusado:
        raise HTTPException(status_code=402, detail="Pagamento recusado pelo provedor")
    return payment


@router.post("/{session_id}/stop", response_model=SessionOut)
def stop_session(session_id: int, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    session = _get_session_for(db, session_id, user)
    _run(session_ops.stop, db, session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/{session_id}/receipt", response_model=ReceiptOut)
def get_receipt(session_id: int, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    session = _get_session_for(db, session_id, user)
    payment = next((p for p in session.payments if p.status == PaymentStatus.aprovado), None)
    if payment is None:
        raise HTTPException(status_code=409, detail="Sessao ainda sem pagamento aprovado: nao ha comprovante")
    energy, amount = live_energy_and_amount(session)
    provider = payments.get_provider()
    return ReceiptOut(
        receipt_number=receipt_number(session.id, payment.created_at),
        session_id=session.id,
        station_name=session.station_name,
        charger_code=session.charger_code,
        mode=session.mode,
        started_at=session.started_at,
        ended_at=session.ended_at,
        energy_kwh=energy,
        price_per_kwh=session.price_per_kwh_snapshot,
        price_source=session.price_source,
        price_occupancy=session.price_occupancy,
        price_note=pricing.price_note(session.price_source, session.price_occupancy),
        amount=amount,
        payment=PaymentOut.model_validate(payment),
        origem=provider.name,
        aviso=(
            "Comprovante de teste (pagamento sandbox), sem valor fiscal."
            if not provider.real
            else "Comprovante do pagamento, sem valor fiscal."
        ),
    )

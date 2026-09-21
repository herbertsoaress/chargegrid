from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import Charger, ChargerStatus, ChargingSession, Payment, PaymentStatus, Station, User
from app.routers.sessions import receipt_number
from app.schemas import (
    BalancingSnapshot,
    BillingSummary,
    InvoiceOut,
    PowerCurvePoint,
    PricingPoint,
)
from app.security import require_operator
from app.services.balancing import balancing_snapshot
from app.services import forecast, modbus_meter
from app.services.pricing import power_curve_table, pricing_table
from app.timeutil import local_datetime, local_hour, local_midnight_utc, utcnow

router = APIRouter(prefix="/billing", tags=["billing"])


def _abbreviate(name: str) -> str:
    """'João Silva' -> 'João S.' (nomes completos nao saem em telas operacionais)."""
    parts = name.split()
    return name if len(parts) < 2 else f"{parts[0]} {parts[-1][0]}."


def _active_ev_load_kw(db: DbSession) -> float:
    return forecast.active_ev_load_kw(db)


@router.get("/summary", response_model=BillingSummary)
def billing_summary(db: DbSession = Depends(get_db), _operator: User = Depends(require_operator)):
    """Dashboard do estabelecimento (Etapa 4): energia, receita, sessoes e carga da rede."""
    today_start = local_midnight_utc()
    ended_today = (
        db.query(ChargingSession)
        .filter(ChargingSession.ended_at.isnot(None), ChargingSession.ended_at >= today_start)
        .all()
    )
    active_sessions = db.query(ChargingSession).filter(ChargingSession.ended_at.is_(None)).count()
    return BillingSummary(
        daily_energy_kwh=round(sum(s.energy_kwh for s in ended_today), 2),
        daily_revenue=round(sum(s.amount_due for s in ended_today), 2),
        active_sessions=active_sessions,
        available_chargers=db.query(Charger).filter(Charger.status == ChargerStatus.livre).count(),
        network_capacity_kw=round(sum(st.power_limit_kw for st in db.query(Station).all()), 1),
        network_used_kw=round(_active_ev_load_kw(db), 1),
    )


@router.get("/invoices", response_model=list[InvoiceOut])
def billing_invoices(
    limit: int = Query(default=50, ge=1, le=200),
    db: DbSession = Depends(get_db),
    _operator: User = Depends(require_operator),
):
    """Comprovantes (pagamentos sandbox aprovados) com rastreabilidade sessao -> kWh -> valor."""
    payments = (
        db.query(Payment)
        .filter(Payment.status == PaymentStatus.aprovado)
        .order_by(Payment.id.desc())
        .limit(limit)
        .all()
    )
    return [
        InvoiceOut(
            receipt_number=receipt_number(p.session_id, p.created_at),
            session_id=p.session_id,
            user_name=_abbreviate(p.session.user.name),
            charger_code=p.session.charger.code,
            energy_kwh=p.session.energy_kwh,
            price_per_kwh=p.session.price_per_kwh_snapshot,
            amount=p.amount,
            method=p.method,
            status=p.status,
            provider_ref=p.provider_ref,
            paid_at=p.created_at,
        )
        for p in payments
    ]


@router.get("/pricing", response_model=list[PricingPoint])
def billing_pricing(weekday: int | None = Query(default=None, ge=0, le=6), station_type: str | None = None):
    """Tabela de tarifas (publica): preco por kWh em cada hora, para um dia da semana (padrao: hoje).

    `station_type` e aceito e ignorado (compatibilidade com o frontend antigo; hoje ha um unico local).
    """
    return pricing_table(local_datetime().weekday() if weekday is None else weekday)


@router.get("/power-curve", response_model=list[PowerCurvePoint])
def billing_power_curve(weekday: int | None = Query(default=None, ge=0, le=6), station_type: str | None = None):
    """Carga prevista dos carros (kW) por hora."""
    return power_curve_table(local_datetime().weekday() if weekday is None else weekday)


@router.get("/balancing", response_model=BalancingSnapshot)
def billing_balancing(db: DbSession = Depends(get_db), _operator: User = Depends(require_operator)):
    ev_kw = _active_ev_load_kw(db)
    meter = modbus_meter.fresh_reading()
    if meter is not None:  # o medidor mede o TOTAL do local: predio = total - carros
        building_kw = max(0.0, meter["active_power_w"] / 1000 - ev_kw)
        return balancing_snapshot(ev_kw, local_hour(), building_kw, "modbus")
    return balancing_snapshot(ev_kw, local_hour())

from datetime import datetime, time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import Charger, ChargerStatus, ChargingSession, Station, StationType
from app.routers.sessions import MODE_FACTOR
from app.schemas import BalancingSnapshot, BillingSummary, PowerCurvePoint, PricingPoint
from app.services.balancing import balancing_snapshot
from app.services.pricing import power_curve_table, pricing_table

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/summary", response_model=BillingSummary)
def billing_summary(db: DbSession = Depends(get_db)):
    today_start = datetime.combine(datetime.utcnow().date(), time.min)

    ended_today = (
        db.query(ChargingSession)
        .filter(ChargingSession.ended_at.isnot(None), ChargingSession.ended_at >= today_start)
        .all()
    )
    daily_energy_kwh = round(sum(s.energy_kwh for s in ended_today), 2)
    daily_revenue = round(sum(s.amount_due for s in ended_today), 2)

    active_sessions = db.query(ChargingSession).filter(ChargingSession.ended_at.is_(None)).all()
    network_used_kw = 0.0
    for s in active_sessions:
        network_used_kw += s.charger.max_power_kw * MODE_FACTOR[s.mode]

    available_chargers = db.query(Charger).filter(Charger.status == ChargerStatus.livre).count()
    network_capacity_kw = sum(st.power_limit_kw for st in db.query(Station).all())

    return BillingSummary(
        daily_energy_kwh=daily_energy_kwh,
        daily_revenue=daily_revenue,
        active_sessions=len(active_sessions),
        available_chargers=available_chargers,
        network_capacity_kw=round(network_capacity_kw, 1),
        network_used_kw=round(network_used_kw, 1),
    )


@router.get("/pricing", response_model=list[PricingPoint])
def billing_pricing(station_type: StationType = StationType.comercial):
    return pricing_table(station_type)


@router.get("/power-curve", response_model=list[PowerCurvePoint])
def billing_power_curve(station_type: StationType = StationType.comercial):
    return power_curve_table(station_type)


@router.get("/balancing", response_model=BalancingSnapshot)
def billing_balancing(db: DbSession = Depends(get_db)):
    now = datetime.utcnow()
    active_sessions = db.query(ChargingSession).filter(ChargingSession.ended_at.is_(None)).all()
    ev_load_kw = sum(s.charger.max_power_kw * MODE_FACTOR[s.mode] for s in active_sessions)
    return balancing_snapshot(ev_load_kw, now.hour + now.minute / 60)

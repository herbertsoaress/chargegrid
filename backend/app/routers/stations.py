from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.db import get_db
from app.models import Station
from app.schemas import GoodWeReadingOut, StationOut
from app.services.goodwe_adapter import get_adapter

router = APIRouter(prefix="/stations", tags=["stations"])


@router.get("", response_model=list[StationOut])
def list_stations(db: Session = Depends(get_db)):
    return db.query(Station).options(joinedload(Station.chargers)).all()


@router.get("/{station_id}", response_model=StationOut)
def get_station(station_id: int, db: Session = Depends(get_db)):
    station = db.query(Station).options(joinedload(Station.chargers)).get(station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Estacao nao encontrada")
    return station


@router.get("/{station_id}/telemetry", response_model=GoodWeReadingOut)
def get_station_telemetry(station_id: int, db: Session = Depends(get_db)):
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Estacao nao encontrada")
    adapter = get_adapter()
    reading = adapter.get_realtime(station)
    return GoodWeReadingOut(
        station_id=station.id,
        origem=reading["origem"],
        timestamp=reading["timestamp"],
        power_kw=reading["power_kw"],
        soc_percent=reading.get("soc_percent"),
    )

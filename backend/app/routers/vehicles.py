from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import User, Vehicle
from app.schemas import VehicleCreate, VehicleOut
from app.security import get_current_user

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("/me", response_model=list[VehicleOut])
def list_my_vehicles(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Vehicle).filter(Vehicle.user_id == user.id).all()


@router.post("", response_model=VehicleOut)
def create_vehicle(payload: VehicleCreate, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    vehicle = Vehicle(user_id=user.id, plate=payload.plate, model=payload.model)
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle

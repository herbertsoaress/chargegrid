from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import ChargingSession, User, Vehicle
from app.schemas import VehicleCreate, VehicleOut
from app.security import get_current_user

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("/me", response_model=list[VehicleOut])
def list_my_vehicles(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Vehicle).filter(Vehicle.user_id == user.id).all()


@router.post("", response_model=VehicleOut)
def create_vehicle(payload: VehicleCreate, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    plate = payload.plate.strip().upper().replace("-", "").replace(" ", "")
    if not plate.isalnum() or not 5 <= len(plate) <= 8:
        raise HTTPException(status_code=422, detail="Placa invalida: use letras e numeros (ex.: ABC1D23)")
    vehicle = Vehicle(user_id=user.id, plate=plate, model=payload.model.strip())
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(vehicle_id: int, db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.user_id != user.id:  # nao revela veiculos de outros usuarios
        raise HTTPException(status_code=404, detail="Veiculo nao encontrado")
    if db.query(ChargingSession).filter(ChargingSession.vehicle_id == vehicle_id).first():
        raise HTTPException(status_code=409, detail="Veiculo tem sessoes no historico e nao pode ser removido")
    db.delete(vehicle)
    db.commit()

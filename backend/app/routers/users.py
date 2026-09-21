from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession, joinedload

from app.db import get_db
from app.models import ChargingSession, Role, User
from app.schemas import UserFleetOut, VehicleOut
from app.security import require_operator

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserFleetOut])
def list_users_and_fleets(db: DbSession = Depends(get_db), _operator: object = Depends(require_operator)):
    drivers = db.query(User).options(joinedload(User.vehicles)).filter(User.role == Role.driver).all()
    result = []
    for driver in drivers:
        sessions = db.query(ChargingSession).filter(ChargingSession.user_id == driver.id).all()
        result.append(
            UserFleetOut(
                id=driver.id,
                name=driver.name,
                email=driver.email,
                vehicles=[VehicleOut(id=v.id, plate=v.plate, model=v.model) for v in driver.vehicles],
                total_sessions=len(sessions),
                total_spent=round(sum(s.amount_due for s in sessions if s.ended_at), 2),
            )
        )
    return result

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
        session_count = db.query(ChargingSession).filter(ChargingSession.user_id == driver.id).count()
        result.append(
            UserFleetOut(
                id=driver.id,
                name=driver.name,
                email=driver.email,
                vehicles=[VehicleOut(id=v.id, plate=v.plate, model=v.model) for v in driver.vehicles],
                total_sessions=session_count,
            )
        )
    return result

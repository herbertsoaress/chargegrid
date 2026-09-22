from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession, joinedload

from app.db import get_db
from app.models import ChargingSession, Role, User
from app.schemas import LoyaltyOut, UserFleetOut, VehicleOut
from app.security import get_current_user, require_operator
from app.services import loyalty

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me/loyalty", response_model=LoyaltyOut)
def my_loyalty(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Pontuacao do proprio motorista: 10 pontos por kWh + bonus por bater a meta semanal (3
    sessoes/semana). E so visual (selo e barra de meta), calculado na hora a partir do historico."""
    if user.role != Role.driver:
        raise HTTPException(status_code=403, detail="Pontuacao e so para contas de motorista")
    status = loyalty.status_for(db, user.id)
    return LoyaltyOut(
        points=status.points,
        tier=status.tier,
        next_tier=status.next_tier,
        points_to_next_tier=status.points_to_next_tier,
        week_sessions=status.week_sessions,
        week_goal=status.week_goal,
        week_goal_met=status.week_goal_met,
        weeks_goal_met=status.weeks_goal_met,
        points_per_kwh=status.points_per_kwh,
        weekly_goal_bonus=status.weekly_goal_bonus,
    )


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

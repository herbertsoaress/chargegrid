from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Charger
from app.schemas import ChargerOut

router = APIRouter(prefix="/chargers", tags=["chargers"])


@router.get("", response_model=list[ChargerOut])
def list_chargers(db: Session = Depends(get_db)):
    return db.query(Charger).all()


@router.get("/{charger_id}", response_model=ChargerOut)
def get_charger(charger_id: int, db: Session = Depends(get_db)):
    charger = db.get(Charger, charger_id)
    if not charger:
        raise HTTPException(status_code=404, detail="Carregador nao encontrado")
    return charger

from fastapi import APIRouter

from app.schemas import GoodWeStatus
from app.services.goodwe_adapter import get_adapter

router = APIRouter(prefix="/goodwe", tags=["goodwe"])


@router.get("/status", response_model=GoodWeStatus)
def goodwe_status():
    adapter = get_adapter()
    return adapter.get_status()

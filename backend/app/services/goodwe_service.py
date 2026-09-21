"""Cola entre o adaptador GoodWe, o banco e a trilha de auditoria."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import GoodWeReading, Station
from app.services.goodwe_adapter import GoodWeAdapter, GoodWeIntegrationError
from app.services.integration_log import log_integration
from app.timeutil import utcnow

READING_MIN_INTERVAL_S = 30  # nao grava uma leitura por request; no maximo uma a cada 30 s


def call_adapter(db: Session, description: str, fn):
    """Executa uma chamada ao adaptador; falhas viram log + HTTP 502 (nunca stack trace)."""
    try:
        return fn()
    except GoodWeIntegrationError as exc:
        log_integration(db, "goodwe", "ERR", str(exc), {"chamada": description})
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def fetch_and_store_reading(db: Session, adapter: GoodWeAdapter, station: Station) -> dict:
    reading = call_adapter(db, f"telemetria da estacao {station.id}", lambda: adapter.get_realtime(station))
    last = (
        db.query(GoodWeReading)
        .filter(GoodWeReading.station_id == station.id)
        .order_by(GoodWeReading.id.desc())
        .first()
    )
    if last is None or (utcnow() - last.timestamp).total_seconds() >= READING_MIN_INTERVAL_S:
        db.add(
            GoodWeReading(
                station_id=station.id,
                origem=reading["origem"],
                timestamp=reading["timestamp"],
                power_kw=reading["power_kw"],
                soc_percent=reading.get("soc_percent"),
                raw_json=reading.get("raw_json", {}),
            )
        )
        db.commit()
    return reading

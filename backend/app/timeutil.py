from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

from app.config import settings


def utcnow() -> datetime:
    """UTC "ingenuo" (sem tzinfo), compativel com as colunas DateTime do banco.

    Substitui datetime.utcnow(), deprecado no Python 3.12+.
    """
    return datetime.now(UTC).replace(tzinfo=None)


def _zone() -> ZoneInfo:
    return ZoneInfo(settings.app_timezone)


def local_datetime(moment: datetime | None = None) -> datetime:
    """Data e hora LOCAIS (com fuso) a partir de um UTC ingenuo. Serve para dia da semana e hora."""
    return (moment or utcnow()).replace(tzinfo=UTC).astimezone(_zone())


def local_hour(moment: datetime | None = None) -> float:
    """Hora do dia LOCAL (ex.: 14.5 = 14h30 em Brasilia) a partir de um UTC ingenuo.

    A tarifa e as curvas de potencia dependem da hora local: o pico "do meio-dia"
    precisa ser meio-dia em Sao Paulo, nao em Greenwich.
    """
    utc_moment = (moment or utcnow()).replace(tzinfo=UTC)
    local = utc_moment.astimezone(_zone())
    return local.hour + local.minute / 60


def local_midnight_utc(moment: datetime | None = None) -> datetime:
    """Inicio do dia LOCAL de hoje, expresso em UTC ingenuo (para filtrar 'hoje' no banco)."""
    utc_moment = (moment or utcnow()).replace(tzinfo=UTC)
    local_day = utc_moment.astimezone(_zone()).date()
    start_local = datetime.combine(local_day, time.min, tzinfo=_zone())
    return start_local.astimezone(UTC).replace(tzinfo=None)

"""Controlador simulado de carregador (Etapa 2 da proposta).

Enquanto nao existe um carregador GoodWe real vinculado a conta da FIAP, este
modulo faz o papel do equipamento: decide qual potencia o carregador entrega em
cada modo e quanta energia (kWh) uma sessao acumulou. Quando houver hardware/API
real, a telemetria chega pelo endpoint de MeterValues (ver routers/sessions.py) e
este calculo passa a ser apenas o "plano B" quando nenhum valor foi reportado.
"""

from datetime import datetime

from app.config import settings
from app.models import ChargingSession, SessionMode
from app.timeutil import utcnow

# fracao da potencia maxima do carregador usada por cada modo de recarga
MODE_FACTOR: dict[SessionMode, float] = {
    SessionMode.rapido: 1.0,
    SessionMode.economico: 0.55,
    SessionMode.sustentavel: 0.75,
    SessionMode.garantido: 0.85,
}

BATTERY_KWH = 60.0  # capacidade media da frota simulada
DEFAULT_START_PCT = 28.0  # % de bateria com que o veiculo chega (mesmo valor do app)


def nominal_power_kw(session: ChargingSession) -> float:
    return round(session.charger.max_power_kw * MODE_FACTOR[session.mode], 2)


def charging_hours(session: ChargingSession, now: datetime | None = None) -> float:
    """Horas (ja com a aceleracao SIM_TIME_SCALE) desde que a energia foi liberada."""
    if session.charging_started_at is None:
        return 0.0
    end = session.ended_at or now or utcnow()
    seconds = max((end - session.charging_started_at).total_seconds(), 0.0)
    return seconds / 3600 * settings.sim_time_scale


def simulated_energy_kwh(session: ChargingSession, now: datetime | None = None) -> float:
    if not session.power_released:
        return 0.0
    return round(nominal_power_kw(session) * charging_hours(session, now), 3)


def soc_from_energy(energy_kwh: float, start_pct: float = DEFAULT_START_PCT) -> float:
    return round(min(100.0, start_pct + energy_kwh / BATTERY_KWH * 100), 1)

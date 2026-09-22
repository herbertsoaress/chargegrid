"""Pontuacao do motorista (fidelidade): extensao aprovada pelo grupo, fora do playbook e da
proposta original (ver docs/ETAPA_5_PROPOSTA.md). Pensada para reter o cliente do posto sem mexer
na tarifa dinamica -- o preco do kWh continua igual pra todo mundo, os pontos sao so um selo.

    pontos = (kWh entregues em TODAS as sessoes encerradas) * PONTOS_POR_KWH
           + (numero de semanas em que o motorista bateu a meta) * BONUS_META_SEMANAL

Os pontos sao SEMPRE calculados na hora, a partir das sessoes do banco -- nao ha uma "carteira"
separada para desincronizar. Por enquanto e so visual (selo e barra de meta): nao da desconto.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session as DbSession

from app.models import ChargingSession
from app.timeutil import local_datetime, utcnow

POINTS_PER_KWH = 10
WEEKLY_GOAL_SESSIONS = 3
WEEKLY_GOAL_BONUS = 50

# faixas (pontos minimos, nome), da maior para a menor
TIERS: list[tuple[int, str]] = [(2000, "Ouro"), (500, "Prata"), (0, "Bronze")]


@dataclass(frozen=True)
class LoyaltyStatus:
    points: int
    tier: str
    next_tier: str | None
    points_to_next_tier: int | None
    week_sessions: int
    week_goal: int
    week_goal_met: bool
    weeks_goal_met: int
    points_per_kwh: int
    weekly_goal_bonus: int


def _tier_for(points: int) -> tuple[str, str | None, int | None]:
    for i, (threshold, name) in enumerate(TIERS):
        if points >= threshold:
            if i == 0:  # ja esta na faixa mais alta
                return name, None, None
            next_threshold, next_name = TIERS[i - 1]
            return name, next_name, next_threshold - points
    return TIERS[-1][1], None, None  # nunca deveria cair aqui: Bronze cobre 0+


def status_for(db: DbSession, user_id: int, now=None) -> LoyaltyStatus:
    now = now or utcnow()
    sessions = (
        db.query(ChargingSession)
        .filter(ChargingSession.user_id == user_id, ChargingSession.ended_at.isnot(None))
        .all()
    )
    total_kwh = sum(s.energy_kwh for s in sessions)

    # Semana ISO (segunda a domingo) no horario de Brasilia -- a mesma semana que o motorista vive.
    weeks: dict[tuple[int, int], int] = {}
    for s in sessions:
        key = local_datetime(s.ended_at).isocalendar()[:2]
        weeks[key] = weeks.get(key, 0) + 1
    weeks_goal_met = sum(1 for count in weeks.values() if count >= WEEKLY_GOAL_SESSIONS)

    current_week = local_datetime(now).isocalendar()[:2]
    week_sessions = weeks.get(current_week, 0)

    points = round(total_kwh * POINTS_PER_KWH) + weeks_goal_met * WEEKLY_GOAL_BONUS
    tier, next_tier, points_to_next_tier = _tier_for(points)
    return LoyaltyStatus(
        points=points,
        tier=tier,
        next_tier=next_tier,
        points_to_next_tier=points_to_next_tier,
        week_sessions=week_sessions,
        week_goal=WEEKLY_GOAL_SESSIONS,
        week_goal_met=week_sessions >= WEEKLY_GOAL_SESSIONS,
        weeks_goal_met=weeks_goal_met,
        points_per_kwh=POINTS_PER_KWH,
        weekly_goal_bonus=WEEKLY_GOAL_BONUS,
    )

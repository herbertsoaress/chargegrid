"""Geracao solar do local -- SIMULADA (nao ha telemetria real de inversor solar disponivel).

Fonte UNICA de "quanto sol tem agora", usada por services/balancing.py (Balanceamento) e por
services/scheduler.py (Energy Autopilot), para as duas partes do sistema nunca mostrarem numeros
de solar que nao batem entre si.

Curva simplificada (pico ao meio-dia, zero a noite), inspirada no diagrama do prototipo 3D da
Sprint 3 (`SERS-Sprint_1-2026`). Nao vem do playbook da GoodWe: e uma extensao do proprio grupo,
coerente com a identidade da GoodWe (fabricante de inversor solar), mas nao um pedido literal --
ver docs/ENERGY_AUTOPILOT.md.
"""

import math

from app.config import settings


def solar_kw(hour: float) -> float:
    """kW gerados pela usina do local nesta hora local (0 a 24)."""
    return round(max(0.0, settings.solar_capacity_kw * math.sin(math.pi * hour / 24)), 2)

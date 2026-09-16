"""Tarifacao dinamica por horario.

Reaproveita as duas curvas de potencia instantanea documentadas em
`relatorio_final_calculo_integral.pdf` (Challenge Sprint 3 - Modelagem
Matematica e Computacional):

    Posto 1 - ChargeGrid Intelligence (comercial):  P1(t) = 5 + 20*sen(pi*t/24)
    Posto 2 - EV ChargeOps (residencial/condominio): P2(t) = 16 + 15*cos(pi*(t-20)/12)

A leitura de negocio do proprio relatorio (EX.5) e que a energia por faixa de
horario, e nao o total diario, e o dado util para tarifacao dinamica: postos
comerciais tem pico ao meio-dia, postos residenciais tem pico as 20h. Aqui o
preco por kWh acompanha essa curva, normalizada numa faixa comercial de
R$/kWh, para que o horario de maior demanda seja sempre o mais caro em cada
tipo de posto.
"""

import math

from app.models import StationType

PRICE_MIN = 1.20
PRICE_MAX = 2.80

_P1_MIN, _P1_MAX = 5.0, 25.0  # ChargeGrid Intelligence (comercial)
_P2_MIN, _P2_MAX = 1.0, 31.0  # EV ChargeOps (residencial)


def power_curve_kw(station_type: StationType, hour: float) -> float:
    if station_type == StationType.comercial:
        return 5 + 20 * math.sin(math.pi * hour / 24)
    return 16 + 15 * math.cos(math.pi * (hour - 20) / 12)


def _normalize(value: float, vmin: float, vmax: float) -> float:
    ratio = (value - vmin) / (vmax - vmin)
    ratio = max(0.0, min(1.0, ratio))
    return round(PRICE_MIN + ratio * (PRICE_MAX - PRICE_MIN), 2)


def price_per_kwh(station_type: StationType, hour: float) -> float:
    power = power_curve_kw(station_type, hour)
    if station_type == StationType.comercial:
        return _normalize(power, _P1_MIN, _P1_MAX)
    return _normalize(power, _P2_MIN, _P2_MAX)


def pricing_table(station_type: StationType) -> list[dict]:
    return [
        {"hour": h, "station_type": station_type, "price_per_kwh": price_per_kwh(station_type, h)}
        for h in range(24)
    ]


def power_curve_table(station_type: StationType) -> list[dict]:
    """Curva de demanda (kW) por hora do dia, para o grafico de 24h do dashboard."""
    return [
        {"hour": h, "station_type": station_type, "power_kw": round(power_curve_kw(station_type, h), 2)}
        for h in range(24)
    ]

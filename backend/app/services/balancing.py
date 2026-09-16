"""Balanceamento de energia (Energy Engine).

Modelo simplificado inspirado no diagrama do prototipo 3D da Sprint 3
(`SERS-Sprint_1-2026`): geracao solar + bateria ESS complementam a rede
eletrica (limite de importacao de 35 kW) para atender o consumo do predio e
dos carregadores. Dados de geracao solar/bateria sao simulados (nao ha
telemetria real de inversor solar disponivel); o consumo dos carregadores
(`ev_load_kw`) vem das sessoes ativas reais no banco.
"""

import math

GRID_IMPORT_LIMIT_KW = 35.0
BUILDING_BASELINE_LOAD_KW = 10.0


def balancing_snapshot(ev_load_kw: float, hour: float) -> dict:
    solar_kw = round(max(0.0, 18 * math.sin(math.pi * hour / 24)), 2)
    battery_soc_percent = round(55 + 30 * math.sin(math.pi * hour / 12), 1)

    total_demand_kw = round(BUILDING_BASELINE_LOAD_KW + ev_load_kw, 2)
    supplied_by_solar_kw = round(min(solar_kw, total_demand_kw), 2)
    remaining = round(total_demand_kw - supplied_by_solar_kw, 2)
    supplied_by_grid_kw = round(min(remaining, GRID_IMPORT_LIMIT_KW), 2)
    supplied_by_battery_kw = round(max(0.0, remaining - supplied_by_grid_kw), 2)

    return {
        "hour": hour,
        "solar_kw": solar_kw,
        "battery_soc_percent": max(0.0, min(100.0, battery_soc_percent)),
        "building_load_kw": BUILDING_BASELINE_LOAD_KW,
        "ev_load_kw": round(ev_load_kw, 2),
        "total_demand_kw": total_demand_kw,
        "grid_import_limit_kw": GRID_IMPORT_LIMIT_KW,
        "supplied_by_solar_kw": supplied_by_solar_kw,
        "supplied_by_grid_kw": supplied_by_grid_kw,
        "supplied_by_battery_kw": supplied_by_battery_kw,
        "within_grid_limit": supplied_by_grid_kw <= GRID_IMPORT_LIMIT_KW,
    }

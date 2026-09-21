"""Balanceamento de energia (Energy Engine).

Modelo simplificado inspirado no diagrama do prototipo 3D da Sprint 3
(`SERS-Sprint_1-2026`): geracao solar + bateria ESS complementam a rede
eletrica (limite de importacao = potencia contratada, 200 kW no cenario de referencia) para atender o consumo do predio e
dos carregadores. Dados de geracao solar/bateria sao simulados (nao ha
telemetria real de inversor solar disponivel); o consumo dos carregadores
(`ev_load_kw`) vem das sessoes ativas reais no banco.
"""

import math

from app.config import settings

# Cenario de referencia (config.py): potencia contratada e carga base do predio.
GRID_IMPORT_LIMIT_KW = settings.site_contracted_kw
BUILDING_BASELINE_LOAD_KW = settings.site_base_load_kw


def balancing_snapshot(
    ev_load_kw: float, hour: float, building_load_kw: float | None = None, building_source: str = "cenario"
) -> dict:
    """`building_load_kw` vem do medidor MODBUS quando ele esta ligado ("modbus"); senao usa o cenario de referencia."""
    building_kw = BUILDING_BASELINE_LOAD_KW if building_load_kw is None else round(building_load_kw, 2)
    solar_kw = round(max(0.0, 18 * math.sin(math.pi * hour / 24)), 2)
    battery_soc_percent = round(55 + 30 * math.sin(math.pi * hour / 12), 1)

    total_demand_kw = round(building_kw + ev_load_kw, 2)
    supplied_by_solar_kw = round(min(solar_kw, total_demand_kw), 2)
    remaining = round(total_demand_kw - supplied_by_solar_kw, 2)
    supplied_by_grid_kw = round(min(remaining, GRID_IMPORT_LIMIT_KW), 2)
    supplied_by_battery_kw = round(max(0.0, remaining - supplied_by_grid_kw), 2)

    return {
        "hour": hour,
        "solar_kw": solar_kw,
        "battery_soc_percent": max(0.0, min(100.0, battery_soc_percent)),
        "building_load_kw": building_kw,
        "building_source": building_source,
        "ev_load_kw": round(ev_load_kw, 2),
        "total_demand_kw": total_demand_kw,
        "grid_import_limit_kw": GRID_IMPORT_LIMIT_KW,
        "supplied_by_solar_kw": supplied_by_solar_kw,
        "supplied_by_grid_kw": supplied_by_grid_kw,
        "supplied_by_battery_kw": supplied_by_battery_kw,
        "within_grid_limit": supplied_by_grid_kw <= GRID_IMPORT_LIMIT_KW,
    }

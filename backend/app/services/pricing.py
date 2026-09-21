"""Tarifacao dinamica: o preco do kWh acompanha a OCUPACAO prevista da capacidade para carros.

    R$/kWh = PRICE_MIN + (PRICE_MAX - PRICE_MIN) * ocupacao        (ocupacao de 0 a 1)

A ocupacao vem do modelo de previsao (services/forecast.py: dia da semana + hora) e, no momento
de iniciar a sessao, e corrigida pela carga real da rede:

    ocupacao usada = max(ocupacao prevista, carga atual dos carros / capacidade para carros)

Faixa R$ 1,10 a R$ 2,00: dentro do que o mercado brasileiro pratica em 2026 (AC publico ~R$ 0,80 a
1,50; AC em shoppings ~R$ 1,50 a 2,20; DC rapido ~R$ 1,80 a 2,10 -- fontes: blogs do setor, conferir
antes de citar). O piso mantem margem sobre o custo da energia (~R$ 0,80 a 1,00/kWh).

O preco e TRAVADO na abertura da sessao (`price_per_kwh_snapshot`) e o comprovante mostra o motivo.
Se o modelo falhar, cai na curva horaria de reserva (source = "reserva").
"""

from dataclasses import dataclass
from datetime import datetime

from app.config import settings
from app.services import forecast
from app.timeutil import local_datetime

PRICE_MIN = 1.10
PRICE_MAX = 2.00


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def price_from_occupancy(occ: float) -> float:
    return round(PRICE_MIN + (PRICE_MAX - PRICE_MIN) * _clamp01(occ), 2)


@dataclass(frozen=True)
class Quote:
    price: float
    occupancy: float  # ocupacao usada no preco
    predicted: float  # ocupacao prevista pelo modelo
    live: float  # ocupacao real medida na rede
    band: str
    source: str  # "modelo" | "modelo_tempo_real" | "reserva"


def quote(when: datetime | None = None, live_occupancy: float = 0.0) -> Quote:
    """Preco do kWh para um instante (UTC ingenuo; padrao = agora), com correcao pela carga real."""
    local = local_datetime(when)
    hour = local.hour + local.minute / 60
    live = _clamp01(live_occupancy)
    try:
        predicted = forecast.occupancy(forecast.get_active(), local.weekday(), hour)
        source = "modelo"
    except Exception:  # noqa: BLE001 - qualquer falha do modelo cai na curva horaria de reserva
        predicted = settings.peak_occupancy_ref * forecast.hourly_shape(hour)
        source = "reserva"
    used = max(predicted, live)
    if source == "modelo" and live > predicted:
        source = "modelo_tempo_real"
    return Quote(
        price=price_from_occupancy(used),
        occupancy=round(used, 3),
        predicted=round(predicted, 3),
        live=round(live, 3),
        band=forecast.band_for(used),
        source=source,
    )


def price_note(source: str, occupancy: float | None) -> str:
    """Frase para o comprovante: de onde veio o preco."""
    pct = f"{(occupancy or 0) * 100:.0f}%"
    if source == "modelo":
        return f"Preco gerado pelo modelo de previsao (ocupacao prevista de {pct})."
    if source == "modelo_tempo_real":
        return f"Preco gerado pelo modelo, ajustado pela carga real da rede (ocupacao de {pct})."
    if source == "reserva":
        return "Preco pela curva horaria de reserva (modelo indisponivel no momento)."
    return "Preco pela curva horaria (versao anterior do sistema)."


# ---------------------------------------------------------------- tabelas e previsao do dia
def hourly_forecast(weekday: int | None = None, params: forecast.ForecastParams | None = None) -> list[dict]:
    """24 pontos (uma por hora, no meio da hora): ocupacao, carga dos carros, demanda total e preco.

    `weekday` = 0 (segunda) a 6 (domingo); `None` = dia util tipico.
    """
    params = params or forecast.get_active()
    points = []
    for hour in range(24):
        occ = forecast.occupancy(params, weekday, hour + 0.5)
        ev_kw = occ * settings.ev_capacity_kw
        points.append(
            {
                "hour": hour,
                "occupancy": round(occ, 3),
                "ev_load_kw": round(ev_kw, 1),
                "total_demand_kw": round(settings.site_base_load_kw + ev_kw, 1),
                "price_per_kwh": price_from_occupancy(occ),
                "band": forecast.band_for(occ),
            }
        )
    return points


def summarize(points: list[dict]) -> dict:
    """Resumo do dia: pico, faixa de preco, horas de saturacao prevista e janela mais calma (3 h seguidas)."""
    peak = max(points, key=lambda p: p["occupancy"])
    prices = [p["price_per_kwh"] for p in points]
    saturated = [p["hour"] for p in points if p["occupancy"] >= settings.saturation_threshold]
    quietest_start = min(range(22), key=lambda h: sum(points[h + i]["occupancy"] for i in range(3)))
    return {
        "peak_hour": peak["hour"],
        "peak_occupancy": peak["occupancy"],
        "min_price": min(prices),
        "max_price": max(prices),
        "avg_price": round(sum(prices) / len(prices), 2),
        "saturation_hours": saturated,
        "saturation_alert": bool(saturated),
        "quietest_window_start": quietest_start,
        "quietest_window_end": quietest_start + 3,
    }


def pricing_table(weekday: int | None = None) -> list[dict]:
    return [
        {
            "hour": p["hour"],
            "weekday": weekday,
            "occupancy": p["occupancy"],
            "price_per_kwh": p["price_per_kwh"],
            "band": p["band"],
        }
        for p in hourly_forecast(weekday)
    ]


def power_curve_table(weekday: int | None = None) -> list[dict]:
    """Carga prevista dos carros (kW) por hora, para o grafico de 24 h do dashboard."""
    return [{"hour": p["hour"], "power_kw": p["ev_load_kw"]} for p in hourly_forecast(weekday)]


def tariffs_csv(params: forecast.ForecastParams | None = None) -> str:
    """tarifas_horarias.csv: preco por hora (dia util, sabado e domingo) gerado pelo modelo.

    NAO e a tarifa da concessionaria: e o preco de venda do kWh calculado pelo modelo.
    """
    params = params or forecast.get_active()
    util, sat, sun = (hourly_forecast(w, params) for w in (None, 5, 6))
    lines = [
        f"# Gerado pelo modelo de previsao v{params.version} (fonte: {params.source}). "
        "Preco de venda do kWh no local; nao e a tarifa da concessionaria.",
        "hora,faixa_dia_util,preco_dia_util_rs_kwh,preco_sabado_rs_kwh,preco_domingo_rs_kwh",
    ]
    for u, s, d in zip(util, sat, sun):
        lines.append(f"{u['hour']:02d}:00,{u['band']},{u['price_per_kwh']:.2f},{s['price_per_kwh']:.2f},{d['price_per_kwh']:.2f}")
    return "\n".join(lines) + "\n"

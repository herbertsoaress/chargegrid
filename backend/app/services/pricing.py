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

---

Extensao aprovada pelo grupo (fora do playbook e da proposta original -- ver
docs/ETAPA_5_PROPOSTA.md): alem do preco por kWh, a sessao cobra por TEMPO de uso e por POTENCIA
do modo escolhido (`breakdown`, mais abaixo). Tambem travado na abertura da sessao.
"""

from dataclasses import dataclass
from datetime import datetime

from app.config import settings
from app.models import ChargingSession, SessionMode
from app.services import forecast
from app.services.simulator import nominal_power_kw, simulated_energy_kwh
from app.timeutil import local_datetime, utcnow

PRICE_MIN = 1.10
PRICE_MAX = 2.00

MODE_SURCHARGE_SETTING: dict[SessionMode, str] = {
    SessionMode.economico: "mode_surcharge_economico",
    SessionMode.sustentavel: "mode_surcharge_sustentavel",
    SessionMode.garantido: "mode_surcharge_garantido",
    SessionMode.rapido: "mode_surcharge_rapido",
}


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


def mode_surcharge_per_kwh(mode: SessionMode) -> float:
    """Acrescimo no preco do kWh pelo modo (potencia maior = mais caro). Ver config.py."""
    return getattr(settings, MODE_SURCHARGE_SETTING[mode])


@dataclass(frozen=True)
class TariffSnapshot:
    """As tarifas de tempo/potencia/ociosidade a TRAVAR na sessao (services/config.py, no instante em
    que a sessao e criada). Mudar as variaveis de ambiente depois so afeta sessoes novas."""

    mode_surcharge: float
    time_rate_per_minute: float
    idle_rate_per_minute: float
    idle_grace_minutes: float
    price_cap_per_kwh: float


def tariff_snapshot(mode: SessionMode) -> TariffSnapshot:
    return TariffSnapshot(
        mode_surcharge=mode_surcharge_per_kwh(mode),
        time_rate_per_minute=settings.time_rate_per_minute,
        idle_rate_per_minute=settings.idle_rate_per_minute,
        idle_grace_minutes=settings.idle_grace_minutes,
        price_cap_per_kwh=settings.price_cap_per_kwh,
    )


@dataclass(frozen=True)
class PriceBreakdown:
    """Valor de uma sessao, aberto em componentes (para o comprovante e a tela ao vivo)."""

    energy_kwh: float
    energy_price_per_kwh: float  # price_per_kwh_snapshot + mode_surcharge_snapshot
    energy_amount: float
    minutes_charging: float
    time_rate_per_minute: float
    time_amount: float
    minutes_idle: float
    idle_rate_per_minute: float
    idle_amount: float
    raw_total: float  # antes do teto
    price_cap_per_kwh: float
    capped: bool
    total: float


def charging_minutes(energy_kwh: float, session: ChargingSession) -> float:
    """Minutos "de recarga" a partir da energia entregue e da potencia nominal do modo -- a MESMA
    conta que a tela do app usa para estimar o tempo antes de iniciar. Nao e o relogio de parede
    (que pode estar acelerado pela simulacao: SIM_TIME_SCALE, OCPP_SIMULATOR_SPEEDUP)."""
    power = max(0.1, nominal_power_kw(session))
    return round(energy_kwh / power * 60, 2)


def idle_minutes(session: ChargingSession, now: datetime | None = None) -> float:
    """Minutos parado com a bateria cheia, ja descontada a carencia. Este SIM e tempo real (relogio
    de parede): a espera de quem esqueceu o carro na vaga nao e acelerada pela simulacao."""
    if session.full_at is None:
        return 0.0
    end = session.ended_at or now or utcnow()
    elapsed = max((end - session.full_at).total_seconds() / 60, 0.0)
    return round(max(elapsed - session.idle_grace_minutes_snapshot, 0.0), 2)


def breakdown(session: ChargingSession, now: datetime | None = None) -> PriceBreakdown:
    """Valor total da sessao ATE AGORA (ou final, se ja encerrada): energia (preco do modelo +
    acrescimo do modo) + tempo de uso + ociosidade, com um teto sobre o preco medio por kWh
    entregue. Usa as tarifas TRAVADAS na sessao (snapshot na abertura)."""
    energy_kwh = session.energy_kwh if session.last_meter_at else simulated_energy_kwh(session, now)
    energy_price = round(session.price_per_kwh_snapshot + session.mode_surcharge_snapshot, 4)
    energy_amount = round(energy_kwh * energy_price, 2)

    minutes_ch = charging_minutes(energy_kwh, session)
    time_amt = round(minutes_ch * session.time_rate_snapshot, 2)

    minutes_id = idle_minutes(session, now)
    idle_amt = round(minutes_id * session.idle_rate_snapshot, 2)

    raw_total = round(energy_amount + time_amt + idle_amt, 2)
    # price_cap_per_kwh_snapshot = 0.0 em sessoes antigas (de antes desta extensao): sem teto para elas.
    has_cap = session.price_cap_per_kwh_snapshot > 0 and energy_kwh > 0
    cap_total = round(energy_kwh * session.price_cap_per_kwh_snapshot, 2) if has_cap else None
    capped = cap_total is not None and raw_total > cap_total
    total = cap_total if capped else raw_total

    return PriceBreakdown(
        energy_kwh=round(energy_kwh, 3),
        energy_price_per_kwh=energy_price,
        energy_amount=energy_amount,
        minutes_charging=minutes_ch,
        time_rate_per_minute=session.time_rate_snapshot,
        time_amount=time_amt,
        minutes_idle=minutes_id,
        idle_rate_per_minute=session.idle_rate_snapshot,
        idle_amount=idle_amt,
        raw_total=raw_total,
        price_cap_per_kwh=session.price_cap_per_kwh_snapshot,
        capped=capped,
        total=total,
    )


def live_energy_and_amount(session: ChargingSession, now: datetime | None = None) -> tuple[float, float]:
    """Energia e valor "ate agora" para exibir na tela ao vivo (sem fechar a sessao)."""
    if session.ended_at or session.payment_finalized:
        return session.energy_kwh, session.amount_due
    b = breakdown(session, now)
    return b.energy_kwh, b.total


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

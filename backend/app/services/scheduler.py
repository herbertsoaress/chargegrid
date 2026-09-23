"""Energy Autopilot: agendamento de recarga por modo (extensao aprovada pelo grupo, alem do
playbook e da proposta original -- ver docs/ENERGY_AUTOPILOT.md).

Cada modo passa a ser uma POLITICA sobre o mesmo motor, em vez de so uma fracao fixa de potencia:

  * rapido:      sem agenda -- sempre a potencia maxima do carregador (como ja era).
  * economico:   carrega nos blocos de MENOR ocupacao prevista (mais baratos), sem prazo
                 obrigatorio -- se nao couber ate a saida, carrega o que der nos blocos baratos
                 disponiveis e avisa que a meta nao sera batida.
  * sustentavel: carrega nos blocos com sobra de energia SOLAR prevista, mesma logica de "sem
                 prazo obrigatorio" do economico.
  * garantido:   tenta os blocos mais baratos primeiro; se isso NAO for suficiente para bater a
                 meta ate a saida, usa TODOS os blocos restantes na potencia maxima (a "rede de
                 seguranca" que da nome ao modo).

So se aplica quando ha horario de saida informado (senao nao ha o que planejar) e a sessao e
conduzida por OCPP (e o carregador -- real ou virtual -- quem executa a potencia decidida aqui).

O "relogio do plano" (`virtual_now`) anda OCPP_SIMULATOR_SPEEDUP vezes mais rapido que o relogio
real: sem isso, demonstrar um plano das 14h as 18h30 exigiria esperar 4h30 de verdade. Com
speedup=1 (equipamento fisico real), o relogio do plano E o relogio real.
"""

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.orm import Session as DbSession

from app.config import settings
from app.models import ChargingSession, SessionMode
from app.services import forecast, solar
from app.services.simulator import BATTERY_KWH, DEFAULT_START_PCT, nominal_power_kw
from app.timeutil import local_datetime, utcnow

BLOCK_MINUTES = 15
MAX_HORIZON_HOURS = 12.0  # nunca planeja mais que isso a frente (protege contra departure_time absurdo)
MIN_KWH_TO_PLAN = 0.05  # bateria praticamente na meta: nao ha o que planejar


def virtual_now(session: ChargingSession, real_now: datetime | None = None) -> datetime:
    """Relogio do plano: anda OCPP_SIMULATOR_SPEEDUP vezes mais rapido que o real, a partir do
    momento em que a energia foi liberada. Com speedup=1, e o proprio agora (UTC ingenuo)."""
    real_now = real_now or utcnow()
    if session.charging_started_at is None:
        return real_now
    elapsed_s = max(0.0, (real_now - session.charging_started_at).total_seconds())
    return session.charging_started_at + timedelta(seconds=elapsed_s * settings.ocpp_simulator_speedup)


def _parse_departure(session: ChargingSession, ref_local: datetime) -> datetime | None:
    """`departure_time` e "HH:MM" de hoje (ou amanha, se ja passou) no fuso local, a partir de `ref_local`."""
    if not session.departure_time:
        return None
    hh, mm = (int(p) for p in session.departure_time.split(":"))
    candidate = ref_local.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if candidate <= ref_local:
        candidate += timedelta(days=1)
    return candidate


@dataclass(frozen=True)
class Block:
    start: datetime  # local, inicio do bloco
    hour: float  # hora local do inicio (para a previsao de ocupacao/solar)
    occupancy: float
    solar_kw: float
    saturated: bool
    charging: bool  # o plano usa este bloco para carregar?
    reason: str  # "preco_baixo" | "solar" | "meta_em_risco" | "pico_evitado" | "ocioso"


@dataclass(frozen=True)
class Plan:
    mode: SessionMode
    departure: datetime  # local
    energy_needed_kwh: float
    max_power_kw: float
    blocks: list[Block] = field(default_factory=list)
    on_track: bool = True  # o plano entrega a meta ate a saida?
    peak_avoided: bool = False  # segurou a potencia em algum bloco de pico previsto, podendo, por escolha?
    solar_kwh: float = 0.0  # kWh planejados que caem em blocos com sobra de solar
    idle_savings_rs: float = 0.0  # so para "garantido": ociosidade evitada por nao terminar cedo demais


def current_power_kw(plan: Plan | None, real_now: datetime, session: ChargingSession) -> float | None:
    """Potencia que o carregador deve entregar AGORA, segundo o plano. None = sem plano (usa a
    potencia nominal do modo, como antes desta extensao)."""
    if plan is None:
        return None
    now_v = local_datetime(virtual_now(session, real_now))  # b.start e local (ver build_plan)
    for b in plan.blocks:
        if b.start <= now_v < b.start + timedelta(minutes=BLOCK_MINUTES):
            return plan.max_power_kw if b.charging else 0.0
    return 0.0  # fora de todos os blocos planejados (ja passou da janela): nao forca mais potencia


def build_plan(session: ChargingSession, db: DbSession, real_now: datetime | None = None) -> Plan | None:
    """Monta o plano de potencia por bloco para o resto da sessao a partir de AGORA (relogio do
    plano). None = sem agenda: modo Rapido, sem horario de saida, ou bateria ja na meta."""
    if session.mode == SessionMode.rapido or not session.departure_time:
        return None

    real_now = real_now or utcnow()
    now_local = local_datetime(virtual_now(session, real_now))
    departure = _parse_departure(session, now_local)
    if departure is None or departure <= now_local:
        return None

    # A potencia do plano e a do MODO (nao a crua do carregador): assim o Garantido carrega no
    # mesmo ritmo o tempo todo (inclusive nos blocos da "rede de seguranca"), e nao muda de
    # velocidade so porque mudou de bloco -- so o HORARIO escolhido muda por bloco.
    max_power = round(nominal_power_kw(session), 2)
    target_pct = session.target_pct or 100
    current_pct = session.current_pct if session.current_pct else DEFAULT_START_PCT
    energy_needed = max(0.0, (target_pct - current_pct) / 100 * BATTERY_KWH - session.energy_kwh)
    if energy_needed < MIN_KWH_TO_PLAN:
        return None

    horizon_end = min(departure, now_local + timedelta(hours=MAX_HORIZON_HOURS))
    total_blocks = max(1, math.ceil((horizon_end - now_local).total_seconds() / (BLOCK_MINUTES * 60)))

    live_occ = forecast.live_occupancy(db)
    active = forecast.get_active()
    forecasts = []
    cursor = now_local
    for i in range(total_blocks):
        hour = cursor.hour + cursor.minute / 60
        occ = forecast.occupancy(active, cursor.weekday(), hour)
        if i == 0:
            occ = max(occ, live_occ)  # o bloco de agora usa a carga real medida, como o preco da sessao
        forecasts.append(
            {"start": cursor, "hour": hour, "occupancy": occ, "solar_kw": solar.solar_kw(hour), "saturated": occ >= settings.saturation_threshold}
        )
        cursor += timedelta(minutes=BLOCK_MINUTES)

    block_kwh_cap = max_power * (BLOCK_MINUTES / 60)
    blocks_needed = math.ceil(round(energy_needed / block_kwh_cap, 6))

    if session.mode == SessionMode.sustentavel:
        order = sorted(range(total_blocks), key=lambda i: (-forecasts[i]["solar_kw"], forecasts[i]["occupancy"]))
    else:  # economico e garantido: mais barato primeiro
        order = sorted(range(total_blocks), key=lambda i: forecasts[i]["occupancy"])

    # Economico e Sustentavel NUNCA carregam num bloco de pico previsto (preferem nao bater a
    # meta a carregar caro). Garantido tambem evita, mas so enquanto isso nao coloca a meta em
    # risco -- e a "rede de seguranca" que da nome ao modo.
    non_saturated = [i for i in order if not forecasts[i]["saturated"]]
    saturated = [i for i in order if forecasts[i]["saturated"]]

    chosen = set(non_saturated[:blocks_needed])
    shortfall = blocks_needed - len(chosen)
    on_track = shortfall <= 0

    forced_blocks: set[int] = set()  # blocos de pico usados so pela "rede de seguranca" do Garantido
    if session.mode == SessionMode.garantido and shortfall > 0:
        forced_blocks = set(saturated[:shortfall])
        chosen |= forced_blocks
        on_track = len(chosen) >= blocks_needed

    idle_savings_rs = 0.0
    if session.mode == SessionMode.garantido and on_track and blocks_needed < total_blocks:
        # quanto tempo ficaria ocioso (pago) se tivesse ido direto no maximo em vez de esperar
        naive_finish = now_local + timedelta(minutes=BLOCK_MINUTES * blocks_needed)
        idle_minutes = max(0.0, (departure - naive_finish).total_seconds() / 60 - settings.idle_grace_minutes)
        idle_savings_rs = round(idle_minutes * settings.idle_rate_per_minute, 2)

    # Pico evitado: existe algum bloco de pico previsto que NAO precisou ser usado.
    peak_avoided = bool(set(saturated) - chosen)

    blocks: list[Block] = []
    solar_kwh = 0.0
    for i, f in enumerate(forecasts):
        is_chosen = i in chosen
        if i in forced_blocks:
            reason = "meta_em_risco"  # Garantido usando a rede de seguranca (bloco de pico)
        elif is_chosen and f["solar_kw"] > 0:
            reason, solar_kwh = "solar", solar_kwh + block_kwh_cap
        elif is_chosen:
            reason = "preco_baixo"
        elif f["saturated"]:
            reason = "pico_evitado"
        else:
            reason = "ocioso"
        blocks.append(
            Block(
                start=f["start"], hour=f["hour"], occupancy=round(f["occupancy"], 3), solar_kw=f["solar_kw"],
                saturated=f["saturated"], charging=is_chosen, reason=reason,
            )
        )

    return Plan(
        mode=session.mode, departure=departure, energy_needed_kwh=round(energy_needed, 3), max_power_kw=max_power,
        blocks=blocks, on_track=on_track, peak_avoided=peak_avoided,
        solar_kwh=round(solar_kwh, 3), idle_savings_rs=idle_savings_rs,
    )

"""Previsao de demanda (ocupacao da capacidade para carros): modelo estatistico calibrado com dados reais.

O modelo tem DUAS pecas, e so o FORMATO delas vem dos dados (o tamanho do local e um parametro de cenario):

  1. Indice do dia da semana  I_w  -- calibrado com o CSV do grupo (fase1-base_de_dados-final.csv):
         I_w = (energia total dos registros do dia da semana w / nº de dias do calendario desse dia da semana)
               / (energia total / nº total de dias)
     Conta tambem os dias SEM recarga (ficam de fora do CSV), senao o fim de semana pareceria so 40%
     mais fraco quando na verdade e ~70% mais fraco.
  2. Formato horario  g(h) = P1(h) / 25  -- a curva P1(t) = 5 + 20*sen(pi*t/24) do relatorio de Calculo
     Integral (pico ao meio-dia, minimo a meia-noite). O CSV nao tem hora do dia, entao o formato
     dentro do dia vem desta curva.

Ocupacao prevista (0 a 1) para o dia da semana w e a hora h:

     O(w, h) = min(1, O_ref * (I_w / I_ref) * g(h))

onde I_ref e a media do indice de segunda a sexta e O_ref (PEAK_OCCUPANCY_REF, padrao 0,80) e a
ocupacao de um dia util ao meio-dia -- SUPOSICAO de cenario, ajustavel no .env.

Sem dependencias externas (Python puro). O treino grava uma nova versao em `forecast_models`.
"""

import csv
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field, fields
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from app.config import settings
from app.models import ChargingSession, ForecastModel
from app.services.simulator import nominal_power_kw
from app.timeutil import utcnow

P1_MAX_KW = 25.0  # pico da curva P1 (t = 12 h)
WEEKDAY_NAMES = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"]

BAND_OFF_PEAK = "fora de ponta"
BAND_MID = "intermediaria"
BAND_PEAK = "ponta"

# Indices calibrados com o CSV completo (usados enquanto nao houver uma versao treinada no banco).
DEFAULT_WEEKDAY_INDEX = [1.16, 1.18, 1.22, 1.27, 1.43, 0.38, 0.36]

CLASS_NAMES = {"1": "baixa", "2": "media", "3": "alta"}
REQUIRED_COLUMNS = ("data_sessao", "energia_total_entregue", "tempo_carga_horas", "potencia_media", "categoria_potencia")


@dataclass
class ForecastParams:
    weekday_index: list[float]  # segunda..domingo; 1,0 = media diaria (contando dias sem recarga)
    source: str = "padrao"  # "csv" (treinado) | "padrao" (valores embutidos)
    version: int = 0
    trained_at: str = ""
    training: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    class_profiles: dict = field(default_factory=dict)

    @property
    def weekday_ref(self) -> float:
        """Indice medio de dia util (segunda a sexta)."""
        return sum(self.weekday_index[:5]) / 5

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict) -> "ForecastParams":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})


def default_params() -> ForecastParams:
    return ForecastParams(weekday_index=list(DEFAULT_WEEKDAY_INDEX), source="padrao")


_active: ForecastParams | None = None


def set_active(params: ForecastParams | None) -> None:
    global _active
    _active = params


def get_active() -> ForecastParams:
    return _active or default_params()


# ---------------------------------------------------------------- formato horario e ocupacao
def p1_curve_kw(hour: float) -> float:
    """Curva de potencia do posto comercial (relatorio de Calculo Integral)."""
    return 5 + 20 * math.sin(math.pi * min(max(hour, 0.0), 24.0) / 24)


def hourly_shape(hour: float) -> float:
    """g(h): 1,0 ao meio-dia, 0,2 a meia-noite."""
    return p1_curve_kw(hour) / P1_MAX_KW


def weekday_ratio(params: ForecastParams, weekday: int | None) -> float:
    """I_w / I_ref. `None` = dia util tipico (razao 1)."""
    if weekday is None:
        return 1.0
    return params.weekday_index[weekday] / params.weekday_ref


def occupancy(params: ForecastParams, weekday: int | None, hour: float) -> float:
    value = settings.peak_occupancy_ref * weekday_ratio(params, weekday) * hourly_shape(hour)
    return max(0.0, min(1.0, value))


def band_for(occ: float) -> str:
    if occ < 0.45:
        return BAND_OFF_PEAK
    if occ < 0.70:
        return BAND_MID
    return BAND_PEAK


# ---------------------------------------------------------------- carga em tempo real
def active_ev_load_kw(db: DbSession) -> float:
    """Carga dos carros agora. Ignora sessoes abertas ha mais que SESSION_TTL_MINUTES (abandonadas)."""
    cutoff = utcnow() - timedelta(minutes=settings.session_ttl_minutes)
    active = (
        db.query(ChargingSession)
        .filter(ChargingSession.ended_at.is_(None), ChargingSession.started_at >= cutoff)
        .all()
    )
    return sum(nominal_power_kw(s) for s in active if s.power_released)


def live_occupancy(db: DbSession) -> float:
    capacity = settings.ev_capacity_kw
    return min(1.0, active_ev_load_kw(db) / capacity) if capacity > 0 else 0.0


# ---------------------------------------------------------------- treino
def _pearson(a: list[float], b: list[float]) -> float | None:
    if len(a) < 2 or len(a) != len(b):
        return None
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return None if den == 0 else sum((x - ma) * (y - mb) for x, y in zip(a, b)) / den


def _ols(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Minimos quadrados: (inclinacao, intercepto, R2). Mesma tecnica do relatorio de Estatistica."""
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 0.0
    intercept = my - slope * mx
    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    return slope, intercept, (1 - ss_res / ss_tot) if ss_tot else 1.0


def _calendar_days(start: date, end: date) -> Counter:
    counter: Counter = Counter()
    day = start
    while day <= end:
        counter[day.weekday()] += 1
        day += timedelta(days=1)
    return counter


def _weekday_index(records: list[tuple[date, float]], start: date, end: date) -> tuple[list[float], float]:
    """Indice por dia da semana e energia media por dia (incluindo dias sem recarga)."""
    total_days = (end - start).days + 1
    if total_days < 14:
        raise ValueError("historico curto demais para calibrar o indice semanal (minimo 14 dias)")
    calendar = _calendar_days(start, end)
    energy_by_weekday: dict[int, float] = defaultdict(float)
    for day, energy in records:
        energy_by_weekday[day.weekday()] += energy
    mean_daily = sum(energy_by_weekday.values()) / total_days
    if mean_daily == 0:
        raise ValueError("historico sem energia entregue")
    return [(energy_by_weekday[w] / calendar[w]) / mean_daily if calendar[w] else 1.0 for w in range(7)], mean_daily


def _backtest(records: list[tuple[date, float]], start: date, end: date) -> dict:
    """Treina nos 2/3 iniciais do periodo e mede o erro diario nos 1/3 finais."""
    cutoff = start + (end - start) * 2 // 3
    train = [r for r in records if r[0] <= cutoff]
    test_start = cutoff + timedelta(days=1)
    test_days = (end - test_start).days + 1
    if len(train) < 30 or test_days < 28:
        return {}
    index_train, mean_train = _weekday_index(train, start, cutoff)
    real: dict[date, float] = defaultdict(float)
    for day, energy in records:
        if day > cutoff:
            real[day] += energy
    days = [test_start + timedelta(days=i) for i in range(test_days)]
    actual = [real.get(day, 0.0) for day in days]
    mae_const = sum(abs(a - mean_train) for a in actual) / len(actual)
    mae_model = sum(abs(a - mean_train * index_train[d.weekday()]) for a, d in zip(actual, days)) / len(actual)
    index_test, _ = _weekday_index([r for r in records if r[0] > cutoff], test_start, end)
    return {
        "janela_treino": f"{start}..{cutoff}",
        "janela_teste": f"{test_start}..{end}",
        "mae_diario_constante_kwh": round(mae_const, 1),
        "mae_diario_modelo_kwh": round(mae_model, 1),
        "correlacao_forma_semanal": round(_pearson(index_train, index_test) or 0.0, 3),
    }


def resolve_csv_path(path: str | None = None) -> Path:
    candidate = Path(path or settings.forecast_csv_path)
    return candidate if candidate.is_absolute() else Path(__file__).resolve().parents[2] / candidate


def train_from_csv(path: str | Path | None = None) -> ForecastParams:
    """Calibra o modelo com o CSV de historico. Levanta OSError/ValueError se o arquivo nao servir."""
    csv_path = resolve_csv_path(str(path) if path else None)
    with open(csv_path, encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"CSV sem as colunas: {', '.join(missing)}")
        rows = []
        for row in reader:
            try:
                rows.append(
                    {
                        "date": date.fromisoformat(row["data_sessao"]),
                        "energy": float(row["energia_total_entregue"]),
                        "hours": float(row["tempo_carga_horas"]),
                        "power": float(row["potencia_media"]),
                        "cls": row["categoria_potencia"].strip()[:1],
                    }
                )
            except (ValueError, KeyError):
                continue  # linha incompleta: ignora
    if len(rows) < 30:
        raise ValueError("CSV com menos de 30 registros validos")

    start, end = min(r["date"] for r in rows), max(r["date"] for r in rows)
    records = [(r["date"], r["energy"]) for r in rows]
    index, mean_daily = _weekday_index(records, start, end)

    hours, energy = [r["hours"] for r in rows], [r["energy"] for r in rows]
    slope, intercept, r2_global = _ols(hours, energy)

    profiles: dict[str, dict] = {}
    residual = 0.0
    mean_energy = sum(energy) / len(energy)
    for code in sorted({r["cls"] for r in rows}):
        group = [r for r in rows if r["cls"] == code]
        if len(group) < 10:
            continue
        gs, gi, gr2 = _ols([r["hours"] for r in group], [r["energy"] for r in group])
        residual += sum((r["energy"] - (gs * r["hours"] + gi)) ** 2 for r in group)
        powers = sorted(r["power"] for r in group)
        profiles[CLASS_NAMES.get(code, f"classe_{code}")] = {
            "registros": len(group),
            "potencia_media_kw": round(statistics.mean(powers), 1),
            "potencia_p95_kw": round(powers[int(0.95 * (len(powers) - 1))], 1),
            "horas_medias": round(statistics.mean(r["hours"] for r in group), 2),
            "reta_energia_x_tempo": {"inclinacao": round(gs, 2), "intercepto": round(gi, 2), "r2": round(gr2, 4)},
        }
    ss_tot = sum((e - mean_energy) ** 2 for e in energy)
    r2_by_class = round(1 - residual / ss_tot, 4) if profiles and ss_tot else None

    metrics = {
        "r2_reta_global": round(r2_global, 4),
        "reta_global": {"inclinacao": round(slope, 2), "intercepto": round(intercept, 2)},
        "r2_reta_por_classe": r2_by_class,
        "energia_media_por_dia_kwh": round(mean_daily, 1),
        **_backtest(records, start, end),
    }
    return ForecastParams(
        weekday_index=[round(v, 4) for v in index],
        source="csv",
        training={
            "arquivo": csv_path.name,
            "registros": len(rows),
            "periodo": f"{start}..{end}",
            "nota": "Historico de um unico veiculo (EV100): calibra o padrao semanal, nao o tamanho do local.",
        },
        metrics=metrics,
        class_profiles=profiles,
    )


# ---------------------------------------------------------------- persistencia das versoes
def save_params(db: DbSession, params: ForecastParams) -> ForecastModel:
    params.version = (db.query(func.max(ForecastModel.version)).scalar() or 0) + 1
    params.trained_at = utcnow().isoformat() + "Z"
    row = ForecastModel(
        version=params.version,
        source=params.source,
        rows=int(params.training.get("registros", 0)),
        params_json=params.to_json(),
        metrics_json=params.metrics,
    )
    db.add(row)
    db.commit()
    return row


def load_latest(db: DbSession) -> ForecastParams | None:
    row = db.query(ForecastModel).order_by(ForecastModel.version.desc()).first()
    return ForecastParams.from_json(row.params_json) if row else None


def ensure_model(db: DbSession) -> ForecastParams:
    """Na subida do backend: usa a ultima versao do banco; se nao houver, treina com o CSV (ou usa o padrao)."""
    params = load_latest(db)
    if params is None:
        try:
            params = train_from_csv()
        except (OSError, ValueError):
            params = default_params()
        save_params(db, params)
    set_active(params)
    return params


def retrain(db: DbSession) -> ForecastParams:
    """Novo treino com o CSV atual. Se o CSV nao servir, levanta o erro (a versao ativa nao muda)."""
    params = train_from_csv()
    save_params(db, params)
    set_active(params)
    return params

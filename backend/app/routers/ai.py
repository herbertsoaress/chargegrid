"""IA de previsao de demanda e preco dinamico (pilar "IA aplicada" do playbook GoodWe).

  GET  /ai/forecast      publico   previsao das 24 h de hoje + preco agora + resumo/alerta de saturacao
  GET  /ai/tariffs.csv   publico   tarifas_horarias.csv gerado pelo modelo
  GET  /ai/model         operador  parametros, metricas do treino e historico de versoes
  POST /ai/retrain       operador  retreina com o CSV e ativa a nova versao
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session as DbSession

from app.config import settings
from app.db import get_db
from app.models import ForecastModel, User
from app.schemas import ForecastNow, ForecastOut, ForecastPoint, ForecastSummary, ModelDetailOut, ModelInfo
from app.security import require_operator
from app.services import forecast, pricing
from app.services.integration_log import log_integration
from app.timeutil import local_datetime, utcnow

router = APIRouter(prefix="/ai", tags=["ai"])

NOTE = (
    "Modelo estatistico calibrado com historico de recargas (CSV do grupo) e a curva P1 do relatorio de "
    "Calculo Integral. O nivel de ocupacao (PEAK_OCCUPANCY_REF) e a capacidade para carros sao suposicoes "
    "de cenario. Nao e IA generativa."
)


def _info(params: forecast.ForecastParams) -> ModelInfo:
    return ModelInfo(
        version=params.version,
        source=params.source,
        trained_at=params.trained_at,
        rows=int(params.training.get("registros", 0)),
    )


@router.get("/forecast", response_model=ForecastOut)
def get_forecast(db: DbSession = Depends(get_db)):
    params = forecast.get_active()
    local = local_datetime()
    points = pricing.hourly_forecast(local.weekday(), params)
    quote = pricing.quote(live_occupancy=forecast.live_occupancy(db))
    return ForecastOut(
        modelo=_info(params),
        weekday=local.weekday(),
        weekday_name=forecast.WEEKDAY_NAMES[local.weekday()],
        generated_at=utcnow(),
        points=[ForecastPoint(**p) for p in points],
        summary=ForecastSummary(**pricing.summarize(points)),
        now=ForecastNow(
            occupancy_predicted=quote.predicted,
            occupancy_live=quote.live,
            occupancy_used=quote.occupancy,
            price_per_kwh=quote.price,
            band=quote.band,
            source=quote.source,
        ),
        weekday_index=params.weekday_index,
        capacity_kw=settings.ev_capacity_kw,
        base_load_kw=settings.site_base_load_kw,
        contracted_kw=settings.site_contracted_kw,
        peak_occupancy_ref=settings.peak_occupancy_ref,
        price_min=pricing.PRICE_MIN,
        price_max=pricing.PRICE_MAX,
        note=NOTE,
    )


@router.get("/tariffs.csv")
def get_tariffs_csv():
    return Response(
        content=pricing.tariffs_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="tarifas_horarias.csv"'},
    )


@router.get("/model", response_model=ModelDetailOut)
def get_model(db: DbSession = Depends(get_db), _operator: User = Depends(require_operator)):
    params = forecast.get_active()
    history = db.query(ForecastModel).order_by(ForecastModel.version.desc()).limit(10).all()
    return ModelDetailOut(
        info=_info(params),
        weekday_index=params.weekday_index,
        training=params.training,
        metrics=params.metrics,
        class_profiles=params.class_profiles,
        history=[
            ModelInfo(version=m.version, source=m.source, trained_at=m.trained_at.isoformat() + "Z", rows=m.rows)
            for m in history
        ],
    )


@router.post("/retrain", response_model=ModelInfo)
def retrain_model(db: DbSession = Depends(get_db), operator: User = Depends(require_operator)):
    try:
        params = forecast.retrain(db)
    except (OSError, ValueError) as exc:
        log_integration(db, "ai-forecast", "ERR", f"Retreino falhou: {exc}")
        raise HTTPException(status_code=422, detail=f"Nao foi possivel treinar com o CSV: {exc}") from exc
    log_integration(
        db,
        "ai-forecast",
        "INFO",
        f"Modelo v{params.version} treinado por {operator.email} ({params.training.get('registros', 0)} registros)",
        {"metrics": params.metrics},
    )
    return _info(params)

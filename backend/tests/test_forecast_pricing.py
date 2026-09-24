import pytest

from app.config import settings
from app.models import Charger, ForecastModel, Station
from app.services import forecast, pricing
from app.services.forecast import ForecastParams, default_params, train_from_csv
from tests.conftest import free_charger_id, start_charging

MON, FRI, SAT, SUN = 0, 4, 5, 6


@pytest.fixture(autouse=True)
def _default_model():
    forecast.set_active(None)
    yield
    forecast.set_active(None)


def hour_price(weekday, hour):
    return next(p for p in pricing.hourly_forecast(weekday) if p["hour"] == hour)


# ---------------- treino com o CSV real do grupo ----------------
def test_training_reproduces_the_numbers_of_the_sprint_report():
    params = train_from_csv()
    assert params.source == "csv" and params.training["registros"] == 343
    assert params.training["periodo"] == "2018-06-07..2021-06-30"
    # regressao tempo x energia = a do relatorio de Estatistica (30,36 / -26,88 / R2 0,7357)
    assert params.metrics["reta_global"] == {"inclinacao": 30.36, "intercepto": -26.88}
    assert params.metrics["r2_reta_global"] == pytest.approx(0.7357, abs=1e-4)
    # uma reta por classe de potencia explica mais que a reta unica
    assert params.metrics["r2_reta_por_classe"] == pytest.approx(0.8777, abs=1e-3)
    assert params.metrics["r2_reta_por_classe"] > params.metrics["r2_reta_global"]
    assert set(params.class_profiles) == {"baixa", "media"}
    assert params.class_profiles["media"]["potencia_media_kw"] == pytest.approx(30.4, abs=0.1)


def test_weekday_index_counts_days_without_recharge():
    index = train_from_csv().weekday_index
    for trained, embedded in zip(index, forecast.DEFAULT_WEEKDAY_INDEX):
        assert trained == pytest.approx(embedded, abs=0.01)  # os valores embutidos vem deste CSV
    assert min(index[:5]) > 1.0  # dia util acima da media diaria
    assert max(index[5:]) < 0.5  # fim de semana ~70% abaixo dos dias uteis


def test_backtest_is_reported_honestly():
    metrics = train_from_csv().metrics
    assert metrics["correlacao_forma_semanal"] > 0.8  # o padrao semanal se repete fora da amostra
    # o erro diario melhora pouco (um unico veiculo e muito ruidoso): nao prometemos previsao diaria exata
    assert metrics["mae_diario_modelo_kwh"] <= metrics["mae_diario_constante_kwh"]


def test_training_rejects_bad_csv(tmp_path):
    no_columns = tmp_path / "a.csv"
    no_columns.write_text("x,y\n1,2\n", encoding="utf-8")
    with pytest.raises(ValueError, match="sem as colunas"):
        train_from_csv(no_columns)

    header = "categoria_potencia,tempo_carga_horas,energia_total_entregue,data_sessao,potencia_media\n"
    short = tmp_path / "b.csv"
    short.write_text(header + "1. Baixa,2,20,2020-01-01,10\n", encoding="utf-8")
    with pytest.raises(ValueError, match="menos de 30"):
        train_from_csv(short)

    with pytest.raises(OSError):
        train_from_csv(tmp_path / "nao-existe.csv")


# ---------------- ocupacao prevista e preco ----------------
def test_occupancy_follows_hour_shape_and_weekday():
    params = default_params()
    assert forecast.occupancy(params, None, 12.0) == pytest.approx(settings.peak_occupancy_ref)  # dia util, meio-dia
    assert forecast.occupancy(params, MON, 3.0) < forecast.occupancy(params, MON, 12.0)
    assert forecast.occupancy(params, SAT, 12.0) < 0.4 * forecast.occupancy(params, FRI, 12.0)
    assert all(0.0 <= forecast.occupancy(params, w, h) <= 1.0 for w in range(7) for h in range(24))


def test_price_stays_inside_the_market_band_and_is_monotonic():
    assert pricing.price_from_occupancy(0.0) == pricing.PRICE_MIN == 1.10
    assert pricing.price_from_occupancy(1.0) == pricing.PRICE_MAX == 2.00
    assert pricing.price_from_occupancy(0.5) == 1.55
    assert pricing.price_from_occupancy(-3) == 1.10 and pricing.price_from_occupancy(9) == 2.00
    prices = [pricing.price_from_occupancy(o / 100) for o in range(101)]
    assert prices == sorted(prices)
    assert all(1.10 <= p["price_per_kwh"] <= 2.00 for w in range(7) for p in pricing.hourly_forecast(w))


def test_examples_shown_to_the_team():
    assert hour_price(FRI, 12)["price_per_kwh"] == pytest.approx(1.92, abs=0.01)
    assert hour_price(MON, 12)["price_per_kwh"] == pytest.approx(1.77, abs=0.01)
    assert hour_price(SAT, 12)["price_per_kwh"] == pytest.approx(1.32, abs=0.01)
    assert hour_price(MON, 3)["price_per_kwh"] == pytest.approx(1.47, abs=0.01)
    assert hour_price(MON, 21)["price_per_kwh"] == pytest.approx(1.40, abs=0.005)


def test_summary_alerts_saturation_only_when_expected():
    friday = pricing.summarize(pricing.hourly_forecast(FRI))
    assert friday["saturation_alert"] and 12 in friday["saturation_hours"] and friday["peak_hour"] in (11, 12)
    sunday = pricing.summarize(pricing.hourly_forecast(SUN))
    assert not sunday["saturation_alert"] and sunday["max_price"] < friday["max_price"]
    assert friday["quietest_window_start"] in (0, 21)  # madrugada / fim da noite
    assert friday["min_price"] < friday["avg_price"] < friday["max_price"]


def test_quote_corrects_price_with_live_load():
    night = pricing.quote(None, live_occupancy=0.0)
    busy = pricing.quote(None, live_occupancy=1.0)
    assert busy.price == 2.00 and busy.source == "modelo_tempo_real" and busy.occupancy == 1.0
    assert night.price <= busy.price and night.source == "modelo"
    assert night.live == 0.0 and night.predicted == night.occupancy


def test_quote_falls_back_to_reserve_curve_when_model_fails(monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("modelo indisponivel")

    monkeypatch.setattr(forecast, "occupancy", broken)
    quote = pricing.quote()
    assert quote.source == "reserva" and 1.10 <= quote.price <= 2.00


def test_tariffs_csv_is_generated_from_the_model():
    lines = pricing.tariffs_csv().strip().splitlines()
    assert lines[0].startswith("# Gerado pelo modelo") and "nao e a tarifa da concessionaria" in lines[0]
    assert lines[1].startswith("hora,faixa_dia_util,preco_dia_util_rs_kwh")
    assert len(lines) == 2 + 24 and lines[2].startswith("00:00,")
    peak_row = next(line for line in lines if line.startswith("12:00"))
    assert peak_row.split(",")[1] in ("ponta", "intermediaria") and float(peak_row.split(",")[2]) > 1.7


# ---------------- persistencia das versoes ----------------
def test_ensure_model_trains_once_and_reuses(db_factory):
    db = db_factory()
    try:
        first = forecast.ensure_model(db)
        assert first.version == 1 and first.source == "csv" and forecast.get_active().version == 1
        again = forecast.ensure_model(db)
        assert again.version == 1 and db.query(ForecastModel).count() == 1
        assert again.weekday_index == first.weekday_index
    finally:
        db.close()


def test_ensure_model_uses_embedded_defaults_without_csv(db_factory, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "forecast_csv_path", str(tmp_path / "nao-existe.csv"))
    db = db_factory()
    try:
        params = forecast.ensure_model(db)
        assert params.source == "padrao" and params.weekday_index == forecast.DEFAULT_WEEKDAY_INDEX
    finally:
        db.close()


def test_params_roundtrip_ignores_unknown_keys():
    params = ForecastParams.from_json({**default_params().to_json(), "campo_novo": 1})
    assert params.weekday_index == forecast.DEFAULT_WEEKDAY_INDEX


# ---------------- API ----------------
def test_forecast_endpoint_is_public_and_consistent(client):
    body = client.get("/ai/forecast").json()
    assert len(body["points"]) == 24 and body["modelo"]["version"] >= 1
    assert body["capacity_kw"] == 80 and body["contracted_kw"] == 200 and body["base_load_kw"] == 120
    assert body["price_min"] == 1.10 and body["price_max"] == 2.00
    assert 1.10 <= body["now"]["price_per_kwh"] <= 2.00
    assert "Não é IA generativa" in body["note"]
    assert all(p["total_demand_kw"] == pytest.approx(120 + p["ev_load_kw"], abs=0.11) for p in body["points"])


def test_tariffs_csv_endpoint(client):
    response = client.get("/ai/tariffs.csv")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    assert len(response.text.strip().splitlines()) == 26


def test_model_and_retrain_are_operator_only(client, driver_headers, operator_headers):
    assert client.get("/ai/model").status_code == 401
    assert client.get("/ai/model", headers=driver_headers).status_code == 403
    assert client.post("/ai/retrain", headers=driver_headers).status_code == 403

    detail = client.get("/ai/model", headers=operator_headers).json()
    assert detail["info"]["source"] == "csv" and detail["metrics"]["r2_reta_por_classe"] > 0.87

    first = client.post("/ai/retrain", headers=operator_headers)
    second = client.post("/ai/retrain", headers=operator_headers)
    assert first.status_code == second.status_code == 200
    assert second.json()["version"] == first.json()["version"] + 1  # cada treino grava uma nova versao
    assert client.get("/ai/model", headers=operator_headers).json()["info"]["version"] == second.json()["version"]
    logs = client.get("/goodwe/logs?limit=20", headers=operator_headers).json()
    assert any(log["source"] == "ai-forecast" and log["level"] == "INFO" for log in logs)


def test_retrain_with_bad_csv_keeps_the_active_model(client, operator_headers, monkeypatch, tmp_path):
    before = client.get("/ai/model", headers=operator_headers).json()["info"]["version"]
    monkeypatch.setattr(settings, "forecast_csv_path", str(tmp_path / "nao-existe.csv"))
    response = client.post("/ai/retrain", headers=operator_headers)
    assert response.status_code == 422 and "Nao foi possivel treinar" in response.json()["detail"]
    assert client.get("/ai/model", headers=operator_headers).json()["info"]["version"] == before


def test_pricing_endpoints_and_legacy_param(client):
    table = client.get("/billing/pricing?weekday=2").json()
    assert len(table) == 24 and {p["weekday"] for p in table} == {2}
    assert {p["band"] for p in table} <= {"fora de ponta", "intermediaria", "ponta"}
    assert client.get("/billing/pricing?station_type=residencial").status_code == 200  # frontend antigo
    assert client.get("/billing/pricing?weekday=9").status_code == 422
    curve = client.get("/billing/power-curve").json()
    assert len(curve) == 24 and max(p["power_kw"] for p in curve) <= 80


# ---------------- sessao: preco travado com motivo ----------------
def test_session_locks_price_with_source_and_receipt_explains_it(client, driver_headers):
    session = start_charging(client, driver_headers, free_charger_id(client, driver_headers))
    assert session["price_source"] in ("modelo", "modelo_tempo_real")
    assert 1.10 <= session["price_per_kwh_snapshot"] <= 2.00 and 0 <= session["price_occupancy"] <= 1

    events = client.get(f"/sessions/{session['id']}/events", headers=driver_headers).json()
    created = next(e for e in events if e["type"] == "session_created")
    assert created["payload_json"]["price_per_kwh"] == session["price_per_kwh_snapshot"]

    assert client.post(f"/sessions/{session['id']}/pay", json={"method": "pix"}, headers=driver_headers).status_code == 200
    receipt = client.get(f"/sessions/{session['id']}/receipt", headers=driver_headers).json()
    assert receipt["price_source"] == session["price_source"]
    assert "Preco gerado pelo modelo" in receipt["price_note"] and "ocupacao" in receipt["price_note"]


def test_session_price_reacts_to_real_load(client, driver_headers, monkeypatch):
    monkeypatch.setattr(forecast, "live_occupancy", lambda db: 1.0)
    session = client.post(
        "/sessions", json={"charger_id": free_charger_id(client, driver_headers), "mode": "rapido"}, headers=driver_headers
    ).json()
    assert session["price_per_kwh_snapshot"] == 2.00 and session["price_source"] == "modelo_tempo_real"


def test_live_load_ignores_abandoned_sessions(client, db_factory, driver_headers):
    from datetime import timedelta

    from app.models import ChargingSession
    from app.timeutil import utcnow

    session = start_charging(client, driver_headers, free_charger_id(client, driver_headers))
    db = db_factory()
    try:
        assert forecast.active_ev_load_kw(db) > 0 and forecast.live_occupancy(db) > 0
        row = db.get(ChargingSession, session["id"])
        row.started_at = utcnow() - timedelta(minutes=settings.session_ttl_minutes + 5)  # sessao esquecida
        db.commit()
        assert forecast.active_ev_load_kw(db) == 0 and forecast.live_occupancy(db) == 0
    finally:
        db.close()


# ---------------- local unico ----------------
def test_seed_creates_a_single_site_with_eight_chargers(db_factory):
    db = db_factory()
    try:
        stations = db.query(Station).all()
        assert [s.name for s in stations] == ["FIAP Paulista"]
        assert stations[0].power_limit_kw == settings.site_contracted_kw == 200
        chargers = db.query(Charger).order_by(Charger.code).all()
        assert [c.code for c in chargers] == [f"CG-{n:03d}" for n in range(1, 9)]
        assert chargers[0].name == "FIAP #1" and chargers[4].status.value == "manutencao"
        assert settings.ev_capacity_kw == 80
    finally:
        db.close()

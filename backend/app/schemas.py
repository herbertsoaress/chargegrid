"""Formatos JSON de entrada e saida da API (Pydantic)."""

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, PlainSerializer

from app.models import ChargerStatus, PaymentMethod, PaymentStatus, Role, SessionMode, StationType


def _iso_utc(value: datetime) -> str:
    """As colunas guardam UTC "ingenuo"; na saida marcamos com Z para o navegador converter certo."""
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.isoformat().replace("+00:00", "Z")


UTCDatetime = Annotated[datetime, PlainSerializer(_iso_utc, return_type=str, when_used="json")]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth ----------
class SignupRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)  # limite do bcrypt


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class DemoLoginRequest(BaseModel):
    role: Role


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Role
    name: str
    user_id: int


class MeOut(ORMModel):
    id: int
    name: str
    email: EmailStr
    role: Role


# ---------- Vehicles ----------
class VehicleCreate(BaseModel):
    plate: str = Field(min_length=5, max_length=10)
    model: str = Field(min_length=2, max_length=80)


class VehicleOut(ORMModel):
    id: int
    plate: str
    model: str


class UserFleetOut(BaseModel):
    id: int
    name: str
    email: str
    vehicles: list[VehicleOut]
    total_sessions: int
    total_spent: float = 0.0


# ---------- Stations / Chargers ----------
class ChargerOut(ORMModel):
    id: int
    code: str
    name: str
    connector_type: str
    status: ChargerStatus
    max_power_kw: float


class StationOut(ORMModel):
    id: int
    name: str
    type: StationType
    address: str
    power_limit_kw: float
    profile_key: str
    chargers: list[ChargerOut] = []


# ---------- Sessions ----------
class SessionCreateRequest(BaseModel):
    charger_id: int
    vehicle_id: int | None = None
    mode: SessionMode = SessionMode.rapido
    vehicle_label: str | None = Field(default=None, max_length=80)
    target_pct: int | None = Field(default=None, ge=1, le=100)
    departure_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class MeterValuesRequest(BaseModel):
    """Leitura de medidor (equivalente ao MeterValues do OCPP)."""

    energy_kwh: float = Field(ge=0)
    power_kw: float = Field(ge=0)
    soc_pct: float | None = Field(default=None, ge=0, le=100)


class SessionEventOut(ORMModel):
    id: int
    type: str
    payload_json: dict
    created_at: UTCDatetime


class SessionOut(ORMModel):
    id: int
    user_id: int
    charger_id: int
    charger_code: str
    charger_name: str
    mode: SessionMode
    vehicle_label: str | None
    target_pct: int | None
    departure_time: str | None
    payment_confirmed: bool
    rfid_ok: bool
    cable_connected: bool
    maintenance_bypass: bool
    payment_finalized: bool
    power_released: bool
    lock_released: bool
    status: str
    started_at: UTCDatetime
    charging_started_at: UTCDatetime | None
    ended_at: UTCDatetime | None
    energy_kwh: float
    current_power_kw: float
    current_pct: float
    price_per_kwh_snapshot: float
    price_source: str
    price_occupancy: float | None
    amount_due: float


class PayRequest(BaseModel):
    method: PaymentMethod


class PaymentOut(ORMModel):
    id: int
    method: PaymentMethod
    status: PaymentStatus
    amount: float
    provider_ref: str
    created_at: UTCDatetime


class ReceiptOut(BaseModel):
    """Comprovante: liga sessao -> consumo -> preco -> valor -> pagamento (Etapa 4)."""

    receipt_number: str
    session_id: int
    station_name: str
    charger_code: str
    mode: SessionMode
    started_at: UTCDatetime
    ended_at: UTCDatetime | None
    energy_kwh: float
    price_per_kwh: float
    price_source: str = "curva"
    price_occupancy: float | None = None
    price_note: str = ""
    amount: float
    payment: PaymentOut | None
    origem: str = "sandbox"
    aviso: str = "Comprovante de teste (pagamento sandbox), sem valor fiscal."


class InvoiceOut(BaseModel):
    receipt_number: str
    session_id: int
    user_name: str
    charger_code: str
    energy_kwh: float
    price_per_kwh: float
    amount: float
    method: PaymentMethod
    status: PaymentStatus
    provider_ref: str
    paid_at: UTCDatetime


class EventOut(BaseModel):
    id: int
    session_id: int
    charger_code: str
    type: str
    payload_json: dict
    created_at: UTCDatetime


# ---------- Billing ----------
class BillingSummary(BaseModel):
    daily_energy_kwh: float
    daily_revenue: float
    active_sessions: int
    available_chargers: int
    network_capacity_kw: float
    network_used_kw: float


class PricingPoint(BaseModel):
    hour: int
    weekday: int | None  # 0 = segunda ... 6 = domingo; None = dia util tipico
    occupancy: float
    price_per_kwh: float
    band: str  # "fora de ponta" | "intermediaria" | "ponta"


class PowerCurvePoint(BaseModel):
    hour: int
    power_kw: float  # carga prevista dos carros nessa hora


# ---------- OCPP ----------
class OcppMessageOut(ORMModel):
    id: int
    charge_point_id: str
    direction: str  # "in" = carregador -> CSMS, "out" = CSMS -> carregador
    message_type: int  # 2 = CALL, 3 = CALLRESULT, 4 = CALLERROR
    action: str
    unique_id: str
    payload_json: dict
    created_at: UTCDatetime


class OcppConnectedOut(BaseModel):
    code: str
    connected_at: UTCDatetime
    last_message_at: UTCDatetime
    vendor: str
    model: str


class OcppStatusOut(BaseModel):
    enabled: bool
    auth_required: bool
    simulator: bool
    protocol: str
    connected: list[OcppConnectedOut]


# ---------- IA: previsao de demanda e preco ----------
class ForecastPoint(BaseModel):
    hour: int
    occupancy: float
    ev_load_kw: float
    total_demand_kw: float
    price_per_kwh: float
    band: str


class ForecastSummary(BaseModel):
    peak_hour: int
    peak_occupancy: float
    min_price: float
    max_price: float
    avg_price: float
    saturation_hours: list[int]
    saturation_alert: bool
    quietest_window_start: int
    quietest_window_end: int


class ForecastNow(BaseModel):
    occupancy_predicted: float
    occupancy_live: float
    occupancy_used: float
    price_per_kwh: float
    band: str
    source: str  # "modelo" | "modelo_tempo_real" | "reserva"


class ModelInfo(BaseModel):
    version: int
    source: str  # "csv" | "padrao"
    trained_at: str
    rows: int


class ForecastOut(BaseModel):
    modelo: ModelInfo
    weekday: int
    weekday_name: str
    generated_at: UTCDatetime
    points: list[ForecastPoint]
    summary: ForecastSummary
    now: ForecastNow
    weekday_index: list[float]
    capacity_kw: float
    base_load_kw: float
    contracted_kw: float
    peak_occupancy_ref: float
    price_min: float
    price_max: float
    note: str


class ModelDetailOut(BaseModel):
    info: ModelInfo
    weekday_index: list[float]
    training: dict
    metrics: dict
    class_profiles: dict
    history: list[ModelInfo]


class BalancingSnapshot(BaseModel):
    hour: float
    solar_kw: float
    battery_soc_percent: float
    building_load_kw: float
    building_source: str = "cenario"  # "modbus" (medidor) ou "cenario" (valor de referencia)
    ev_load_kw: float
    total_demand_kw: float
    grid_import_limit_kw: float
    supplied_by_solar_kw: float
    supplied_by_grid_kw: float
    supplied_by_battery_kw: float
    within_grid_limit: bool


# ---------- GoodWe / integracoes ----------
class GoodWeStatus(BaseModel):
    origem: str
    modo: str
    detalhe: str


class GoodWeReadingOut(BaseModel):
    station_id: int
    origem: str
    timestamp: UTCDatetime
    power_kw: float
    soc_percent: float | None = None


class GoodWePlant(BaseModel):
    id: str
    name: str
    capacity_kw: float
    status: str
    origem: str


class GoodWeDevice(BaseModel):
    id: str
    type: str
    category: str
    serial_masked: str
    status: str
    origem: str


class IntegrationLogOut(ORMModel):
    id: int
    source: str
    level: str
    message: str
    payload_json: dict
    created_at: UTCDatetime


class PeakShavingRequest(BaseModel):
    reduction_pct: int = Field(default=40, ge=1, le=100)
    duration_s: int = Field(default=30, ge=5, le=3600)


# ---------- Assistente ----------
class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=800)


class AssistantQuery(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    # Ultimas mensagens da conversa (o front manda so as trocas reais, sem a saudacao).
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    # Resumo do que o usuario ve na tela (carregadores simulados no navegador). Entra no contexto
    # da IA como dado NAO confiavel, so para ela nao contradizer o que esta na tela.
    screen_snapshot: str = Field(default="", max_length=2000)


class AssistantAnswer(BaseModel):
    answer: str
    category: str
    # "ia" = respondido pelo Gemini; "regras" = assistente por regras (sem chave, sem login,
    # limite atingido ou falha da IA).
    origem: str = "regras"
    modelo: str | None = None


# ---------- Saude ----------
class HealthOut(BaseModel):
    status: str
    version: str
    env: str
    database: dict
    goodwe: dict


# ---------- Medidor MODBUS ----------
class MeterRegisterOut(BaseModel):
    address: int
    name: str
    unit: str


class MeterOut(BaseModel):
    enabled: bool
    protocol: str
    origem: str  # sempre "simulado" enquanto nao houver medidor fisico
    host: str
    port: int
    unit_id: int
    register_map: list[MeterRegisterOut]
    reading: dict | None
    read_at: UTCDatetime | None
    age_s: float | None
    fresh: bool
    error: str | None

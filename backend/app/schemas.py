from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models import ChargerStatus, PaymentMethod, PaymentStatus, Role, SessionMode, StationType


# ---------- Auth ----------
class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Role = Role.driver


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Role
    name: str
    user_id: int


# ---------- Vehicles ----------
class VehicleCreate(BaseModel):
    plate: str
    model: str


class VehicleOut(BaseModel):
    id: int
    plate: str
    model: str

    class Config:
        from_attributes = True


class UserFleetOut(BaseModel):
    id: int
    name: str
    email: str
    vehicles: list[VehicleOut]
    total_sessions: int


# ---------- Stations / Chargers ----------
class ChargerOut(BaseModel):
    id: int
    code: str
    status: ChargerStatus
    max_power_kw: float

    class Config:
        from_attributes = True


class StationOut(BaseModel):
    id: int
    name: str
    type: StationType
    address: str
    power_limit_kw: float
    profile_key: str
    chargers: list[ChargerOut] = []

    class Config:
        from_attributes = True


# ---------- Sessions ----------
class SessionCreateRequest(BaseModel):
    charger_id: int
    vehicle_id: int | None = None
    mode: SessionMode = SessionMode.rapido


class SessionEventOut(BaseModel):
    id: int
    type: str
    payload_json: dict
    created_at: datetime

    class Config:
        from_attributes = True


class SessionOut(BaseModel):
    id: int
    user_id: int
    charger_id: int
    mode: SessionMode
    payment_confirmed: bool
    rfid_ok: bool
    cable_connected: bool
    maintenance_bypass: bool
    payment_finalized: bool
    power_released: bool
    lock_released: bool
    status: str
    started_at: datetime
    ended_at: datetime | None
    energy_kwh: float
    price_per_kwh_snapshot: float
    amount_due: float

    class Config:
        from_attributes = True


class PayRequest(BaseModel):
    method: PaymentMethod


class PaymentOut(BaseModel):
    id: int
    method: PaymentMethod
    status: PaymentStatus
    amount: float
    provider_ref: str
    created_at: datetime

    class Config:
        from_attributes = True


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
    station_type: StationType
    price_per_kwh: float


class PowerCurvePoint(BaseModel):
    hour: int
    station_type: StationType
    power_kw: float


class BalancingSnapshot(BaseModel):
    hour: float
    solar_kw: float
    battery_soc_percent: float
    building_load_kw: float
    ev_load_kw: float
    total_demand_kw: float
    grid_import_limit_kw: float
    supplied_by_solar_kw: float
    supplied_by_grid_kw: float
    supplied_by_battery_kw: float
    within_grid_limit: bool


# ---------- GoodWe ----------
class GoodWeStatus(BaseModel):
    origem: str
    modo: str
    detalhe: str


class GoodWeReadingOut(BaseModel):
    station_id: int
    origem: str
    timestamp: datetime
    power_kw: float
    soc_percent: float | None = None


# ---------- AI assistant ----------
class AssistantQuery(BaseModel):
    question: str


class AssistantAnswer(BaseModel):
    answer: str
    category: str

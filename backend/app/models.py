import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.services.session_fsm import derive_status, lock_released, power_released


class Role(str, enum.Enum):
    driver = "driver"
    operator = "operator"


class StationType(str, enum.Enum):
    comercial = "comercial"
    residencial = "residencial"


class ChargerStatus(str, enum.Enum):
    livre = "livre"
    ocupado = "ocupado"
    manutencao = "manutencao"


class SessionMode(str, enum.Enum):
    rapido = "rapido"
    economico = "economico"
    sustentavel = "sustentavel"


class PaymentMethod(str, enum.Enum):
    pix = "pix"
    cartao = "cartao"


class PaymentStatus(str, enum.Enum):
    pendente = "pendente"
    aprovado = "aprovado"
    recusado = "recusado"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.driver)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="owner")
    sessions: Mapped[list["ChargingSession"]] = relationship(back_populates="user")


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    plate: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(80))

    owner: Mapped["User"] = relationship(back_populates="vehicles")


class Station(Base):
    __tablename__ = "stations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[StationType] = mapped_column(Enum(StationType))
    address: Mapped[str] = mapped_column(String(200), default="")
    power_limit_kw: Mapped[float] = mapped_column(Float, default=35.0)
    # liga a estacao a uma das curvas de potencia documentadas no relatorio de calculo integral
    profile_key: Mapped[str] = mapped_column(String(40), default="chargegrid_intelligence")

    chargers: Mapped[list["Charger"]] = relationship(back_populates="station")


class Charger(Base):
    __tablename__ = "chargers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    code: Mapped[str] = mapped_column(String(20))
    status: Mapped[ChargerStatus] = mapped_column(Enum(ChargerStatus), default=ChargerStatus.livre)
    max_power_kw: Mapped[float] = mapped_column(Float, default=22.0)

    station: Mapped["Station"] = relationship(back_populates="chargers")


class ChargingSession(Base):
    __tablename__ = "charging_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id"), nullable=True)
    charger_id: Mapped[int] = mapped_column(ForeignKey("chargers.id"))
    mode: Mapped[SessionMode] = mapped_column(Enum(SessionMode), default=SessionMode.rapido)

    # variaveis booleanas da maquina de estados (Sprint3_ChargeGrid_ComputerScience.docx)
    payment_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)  # A
    rfid_ok: Mapped[bool] = mapped_column(Boolean, default=False)  # B
    cable_connected: Mapped[bool] = mapped_column(Boolean, default=False)  # C
    maintenance_bypass: Mapped[bool] = mapped_column(Boolean, default=False)  # M
    payment_finalized: Mapped[bool] = mapped_column(Boolean, default=False)  # D

    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    energy_kwh: Mapped[float] = mapped_column(Float, default=0.0)
    price_per_kwh_snapshot: Mapped[float] = mapped_column(Float, default=0.0)
    amount_due: Mapped[float] = mapped_column(Float, default=0.0)

    user: Mapped["User"] = relationship(back_populates="sessions")
    charger: Mapped["Charger"] = relationship()
    events: Mapped[list["SessionEvent"]] = relationship(back_populates="session", order_by="SessionEvent.created_at")
    payments: Mapped[list["Payment"]] = relationship(back_populates="session")

    @property
    def power_released(self) -> bool:
        return power_released(self.payment_confirmed, self.rfid_ok, self.cable_connected, self.maintenance_bypass)

    @property
    def lock_released(self) -> bool:
        return lock_released(
            self.payment_confirmed,
            self.rfid_ok,
            self.cable_connected,
            self.maintenance_bypass,
            self.payment_finalized,
        )

    @property
    def status(self) -> str:
        return derive_status(
            self.payment_confirmed,
            self.rfid_ok,
            self.cable_connected,
            self.maintenance_bypass,
            self.payment_finalized,
        )


class SessionEvent(Base):
    __tablename__ = "session_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("charging_sessions.id"))
    type: Mapped[str] = mapped_column(String(60))
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["ChargingSession"] = relationship(back_populates="events")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("charging_sessions.id"))
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod))
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus), default=PaymentStatus.pendente)
    amount: Mapped[float] = mapped_column(Float)
    provider_ref: Mapped[str] = mapped_column(String(60), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["ChargingSession"] = relationship(back_populates="payments")


class GoodWeReading(Base):
    __tablename__ = "goodwe_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    origem: Mapped[str] = mapped_column(String(20), default="simulado")  # "simulado" | "real"
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    power_kw: Mapped[float] = mapped_column(Float)
    soc_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_json: Mapped[dict] = mapped_column(JSON, default=dict)

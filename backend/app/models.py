"""Tabelas do ChargeGrid.

O SQL equivalente para o Supabase esta em
`supabase/migrations/20260918000000_init_chargegrid.sql` -- se voce mudar um modelo
aqui, mude la tambem (em producao o backend nao cria tabelas sozinho).
Enums sao gravados como texto (native_enum=False) para casar com essa migration.
"""

import enum
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.services.session_fsm import derive_status, lock_released, power_released
from app.timeutil import utcnow


def _enum(cls: type[enum.Enum]) -> Enum:
    return Enum(cls, native_enum=False, length=20, validate_strings=True)


class Role(str, enum.Enum):
    driver = "driver"
    operator = "operator"


class StationType(str, enum.Enum):
    comercial = "comercial"


class ChargerStatus(str, enum.Enum):
    livre = "livre"
    ocupado = "ocupado"
    manutencao = "manutencao"


class SessionMode(str, enum.Enum):
    rapido = "rapido"
    economico = "economico"
    sustentavel = "sustentavel"
    garantido = "garantido"


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
    role: Mapped[Role] = mapped_column(_enum(Role), default=Role.driver)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="owner")
    sessions: Mapped[list["ChargingSession"]] = relationship(back_populates="user")


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plate: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(80))

    owner: Mapped["User"] = relationship(back_populates="vehicles")


class Station(Base):
    __tablename__ = "stations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[StationType] = mapped_column(_enum(StationType))
    address: Mapped[str] = mapped_column(String(200), default="")
    power_limit_kw: Mapped[float] = mapped_column(Float, default=200.0)
    # liga a estacao a uma das curvas de potencia do relatorio de calculo integral
    profile_key: Mapped[str] = mapped_column(String(40), default="chargegrid_intelligence")

    chargers: Mapped[list["Charger"]] = relationship(back_populates="station")


class Charger(Base):
    __tablename__ = "chargers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # ex.: CG-001
    name: Mapped[str] = mapped_column(String(80), default="")  # ex.: Centro #1
    connector_type: Mapped[str] = mapped_column(String(20), default="Type 2 AC")
    status: Mapped[ChargerStatus] = mapped_column(_enum(ChargerStatus), default=ChargerStatus.livre)
    max_power_kw: Mapped[float] = mapped_column(Float, default=22.0)

    station: Mapped["Station"] = relationship(back_populates="chargers")


class ChargingSession(Base):
    __tablename__ = "charging_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id"), nullable=True)
    charger_id: Mapped[int] = mapped_column(ForeignKey("chargers.id"), index=True)
    mode: Mapped[SessionMode] = mapped_column(_enum(SessionMode), default=SessionMode.rapido)

    # dados informados no app do motorista
    vehicle_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    target_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    departure_time: Mapped[str | None] = mapped_column(String(5), nullable=True)  # "HH:MM"

    # variaveis booleanas da maquina de estados (Sprint3_ChargeGrid_ComputerScience.docx)
    payment_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)  # A
    rfid_ok: Mapped[bool] = mapped_column(Boolean, default=False)  # B
    cable_connected: Mapped[bool] = mapped_column(Boolean, default=False)  # C
    maintenance_bypass: Mapped[bool] = mapped_column(Boolean, default=False)  # M
    payment_finalized: Mapped[bool] = mapped_column(Boolean, default=False)  # D

    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # momento em que a energia foi liberada pela primeira vez (S=1); base do calculo de kWh
    charging_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # telemetria (vem do controlador simulado ou, no futuro, do carregador real via MeterValues)
    energy_kwh: Mapped[float] = mapped_column(Float, default=0.0)
    current_power_kw: Mapped[float] = mapped_column(Float, default=0.0)
    current_pct: Mapped[float] = mapped_column(Float, default=0.0)
    last_meter_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    price_per_kwh_snapshot: Mapped[float] = mapped_column(Float, default=0.0)
    # de onde veio o preco: "modelo" | "modelo_tempo_real" | "reserva" | "curva" (sessoes antigas)
    price_source: Mapped[str] = mapped_column(String(24), default="curva")
    price_occupancy: Mapped[float | None] = mapped_column(Float, nullable=True)  # ocupacao usada no preco (0 a 1)
    amount_due: Mapped[float] = mapped_column(Float, default=0.0)

    # Tarifas de tempo/potencia/ociosidade TRAVADAS na abertura (services/pricing.py + config.py).
    # Sessoes antigas (de antes desta extensao) ficam com 0.0 nestes campos: o preco delas continua
    # sendo so energia x price_per_kwh_snapshot (sem tempo/ociosidade), que e o que ja foi cobrado.
    mode_surcharge_snapshot: Mapped[float] = mapped_column(Float, default=0.0)  # R$/kWh, por modo
    time_rate_snapshot: Mapped[float] = mapped_column(Float, default=0.0)  # R$/minuto de recarga
    idle_rate_snapshot: Mapped[float] = mapped_column(Float, default=0.0)  # R$/minuto de ociosidade
    idle_grace_minutes_snapshot: Mapped[float] = mapped_column(Float, default=0.0)
    price_cap_per_kwh_snapshot: Mapped[float] = mapped_column(Float, default=0.0)  # 0 = sem teto (sessoes antigas)
    # instante em que a bateria chegou a 100% pela primeira vez (telemetria); usado para contar ociosidade
    full_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="sessions")
    charger: Mapped["Charger"] = relationship()
    events: Mapped[list["SessionEvent"]] = relationship(back_populates="session", order_by="SessionEvent.id")
    payments: Mapped[list["Payment"]] = relationship(back_populates="session")

    @property
    def charger_code(self) -> str:
        return self.charger.code

    @property
    def charger_name(self) -> str:
        return self.charger.name

    @property
    def station_name(self) -> str:
        return self.charger.station.name

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

    @property
    def price_breakdown(self):
        # import tardio: pricing -> forecast -> models seria um ciclo se importado no topo do arquivo
        from app.services import pricing

        return pricing.breakdown(self)

    @property
    def amount_estimate(self) -> float:
        """Valor total ATE AGORA (energia + tempo + ociosidade, com o teto por kWh aplicado)."""
        return self.price_breakdown.total

    @property
    def energy_amount(self) -> float:
        return self.price_breakdown.energy_amount

    @property
    def time_amount(self) -> float:
        return self.price_breakdown.time_amount

    @property
    def idle_amount(self) -> float:
        return self.price_breakdown.idle_amount

    @property
    def minutes_charging(self) -> float:
        return self.price_breakdown.minutes_charging

    @property
    def minutes_idle(self) -> float:
        return self.price_breakdown.minutes_idle

    @property
    def price_capped(self) -> bool:
        return self.price_breakdown.capped


class SessionEvent(Base):
    __tablename__ = "session_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("charging_sessions.id"), index=True)
    type: Mapped[str] = mapped_column(String(60))
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    session: Mapped["ChargingSession"] = relationship(back_populates="events")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("charging_sessions.id"), index=True)
    method: Mapped[PaymentMethod] = mapped_column(_enum(PaymentMethod))
    status: Mapped[PaymentStatus] = mapped_column(_enum(PaymentStatus), default=PaymentStatus.pendente)
    amount: Mapped[float] = mapped_column(Float)
    provider_ref: Mapped[str] = mapped_column(String(60), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    session: Mapped["ChargingSession"] = relationship(back_populates="payments")


class GoodWeReading(Base):
    __tablename__ = "goodwe_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    origem: Mapped[str] = mapped_column(String(20), default="simulado")  # "simulado" | "real"
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    power_kw: Mapped[float] = mapped_column(Float)
    soc_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_json: Mapped[dict] = mapped_column(JSON, default=dict)


class IntegrationLog(Base):
    """Trilha de auditoria das integracoes (GoodWe, balanceador de carga...).

    Cumpre o entregavel "logs e tratamento de erros" da Etapa 3 da proposta.
    """

    __tablename__ = "integration_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(40))  # "goodwe" | "load-balancer" | ...
    level: Mapped[str] = mapped_column(String(10))  # INFO | WARN | ERR
    message: Mapped[str] = mapped_column(Text)
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ForecastModel(Base):
    """Versoes do modelo de previsao de demanda (parametros + metricas), uma linha por treino."""

    __tablename__ = "forecast_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(20))  # "csv" | "padrao"
    trained_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    rows: Mapped[int] = mapped_column(Integer, default=0)  # registros de historico usados no treino
    params_json: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)


class OcppMessage(Base):
    """Cada mensagem OCPP trocada com um carregador (quadro bruto: [tipo, id, acao, payload]).

    Alimenta a tela "Logs OCPP" com mensagens REAIS (direction: "in" = carregador -> CSMS, "out" = CSMS -> carregador).
    """

    __tablename__ = "ocpp_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    charge_point_id: Mapped[str] = mapped_column(String(20), index=True)  # codigo do carregador, ex.: CG-001
    direction: Mapped[str] = mapped_column(String(3))  # "in" | "out"
    message_type: Mapped[int] = mapped_column(Integer)  # 2 = CALL, 3 = CALLRESULT, 4 = CALLERROR
    action: Mapped[str] = mapped_column(String(40), default="")  # BootNotification, MeterValues...
    unique_id: Mapped[str] = mapped_column(String(40), default="")
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import DEFAULT_SECRET_KEY, settings
from app.db import Base, SessionLocal, engine
from app.routers import (
    ai,
    ai_assistant,
    auth,
    billing,
    chargers,
    events,
    goodwe,
    health,
    ocpp,
    ops,
    sessions,
    stations,
    users,
    vehicles,
)
from app.seed import seed_demo_data
from app.services import forecast, modbus_meter, ocpp_service, payments
from app.services.virtual_charger import start_virtual_chargers


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.is_production and settings.secret_key == DEFAULT_SECRET_KEY:
        raise RuntimeError("SECRET_KEY padrao em producao: defina uma chave secreta longa e aleatoria.")
    payments.get_provider()  # falha ao subir (e nao no primeiro pagamento) se PAYMENT_PROVIDER estiver errado
    if not settings.is_production:
        # Em desenvolvimento cria as tabelas sozinho. Em producao o schema vem da
        # migration do Supabase (supabase/migrations), com RLS ja habilitado.
        Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_demo_data(db)
        forecast.ensure_model(db)  # carrega (ou treina) o modelo de previsao que calcula o preco
        ocpp_service.prune_old_messages(db, settings.ocpp_message_retention_days)
    finally:
        db.close()

    background: list[asyncio.Task] = []
    meter_server = None
    if settings.modbus_simulator:  # medidor de energia virtual (MODBUS TCP) + leitor
        meter_tasks, meter_server = await modbus_meter.start_meter_simulator()
        background += meter_tasks
    if settings.ocpp_simulator:  # carregadores virtuais: hardware simulado que fala OCPP de verdade
        background += await start_virtual_chargers()
    try:
        yield
    finally:
        for task in background:
            task.cancel()
        for task in background:
            with suppress(asyncio.CancelledError, Exception):
                await task
        if meter_server:
            await meter_server.stop()
        modbus_meter.state.reading = modbus_meter.state.read_at = None


app = FastAPI(title="ChargeGrid API", version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(stations.router)
app.include_router(chargers.router)
app.include_router(sessions.router)
app.include_router(events.router)
app.include_router(billing.router)
app.include_router(goodwe.router)
app.include_router(ops.router)
app.include_router(ai_assistant.router)
app.include_router(ai.router)
app.include_router(ocpp.router)
app.include_router(users.router)
app.include_router(vehicles.router)

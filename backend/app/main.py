from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import Base, SessionLocal, engine
from app.routers import ai_assistant, auth, billing, chargers, goodwe, health, sessions, stations, users, vehicles
from app.seed import seed_demo_data

app = FastAPI(title="ChargeGrid API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(stations.router)
app.include_router(chargers.router)
app.include_router(sessions.router)
app.include_router(billing.router)
app.include_router(goodwe.router)
app.include_router(ai_assistant.router)
app.include_router(users.router)
app.include_router(vehicles.router)

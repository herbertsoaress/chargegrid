"""Dados iniciais (estacoes e carregadores) e contas de demonstracao.

Um unico local (FIAP - Unidade Paulista) com 8 carregadores CG-001..CG-008, que espelham os do
app (goodwe-grid-smart): o frontend liga cada carregador local ao registro do banco pelo `code`.
Contas de demonstracao so sao criadas com SEED_DEMO_DATA=true.
"""

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Charger, ChargerStatus, Role, Station, StationType, User, Vehicle
from app.security import hash_password

DEMO_OPERATOR_EMAIL = "operador@chargegrid.demo"
DEMO_DRIVER_EMAIL = "motorista@chargegrid.demo"
DEMO_PASSWORD = "chargegrid123"


def _seed_demo_users(db: Session) -> None:
    if db.query(User).filter(User.email == DEMO_OPERATOR_EMAIL).first():
        return
    operator = User(
        name="Operador GoodWe",
        email=DEMO_OPERATOR_EMAIL,
        password_hash=hash_password(DEMO_PASSWORD),
        role=Role.operator,
    )
    driver = User(
        name="João Silva",
        email=DEMO_DRIVER_EMAIL,
        password_hash=hash_password(DEMO_PASSWORD),
        role=Role.driver,
    )
    db.add_all([operator, driver])
    db.flush()
    db.add(Vehicle(user_id=driver.id, plate="CGD1A23", model="BYD Dolphin"))
    db.commit()


SITE_NAME = "FIAP Paulista"
SITE_ADDRESS = "FIAP - Unidade Paulista"
CHARGER_COUNT = 8
CHARGER_POWER_KW = 22.0  # Type 2 AC (valor ASSUMIDO ate haver a ficha tecnica do carregador da FIAP)
CHARGERS_IN_MAINTENANCE = {"CG-005"}  # 1 carregador em manutencao para demonstrar o status


def _seed_stations(db: Session) -> None:
    if db.query(Station).first():
        return

    site = Station(
        name=SITE_NAME,
        type=StationType.comercial,
        address=SITE_ADDRESS,
        power_limit_kw=settings.site_contracted_kw,
        profile_key="chargegrid_intelligence",
    )
    db.add(site)
    db.flush()

    for number in range(1, CHARGER_COUNT + 1):
        code = f"CG-{number:03d}"
        status = ChargerStatus.manutencao if code in CHARGERS_IN_MAINTENANCE else ChargerStatus.livre
        db.add(
            Charger(
                station_id=site.id,
                code=code,
                name=f"FIAP #{number}",
                max_power_kw=CHARGER_POWER_KW,
                status=status,
            )
        )
    db.commit()


def seed_demo_data(db: Session) -> None:
    _seed_stations(db)
    if settings.seed_demo_data:
        _seed_demo_users(db)

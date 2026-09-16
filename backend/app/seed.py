from sqlalchemy.orm import Session

from app.models import Charger, ChargerStatus, Role, Station, StationType, User, Vehicle
from app.security import hash_password


def seed_demo_data(db: Session) -> None:
    if db.query(Station).first():
        return  # ja populado

    operator = User(
        name="Operador GoodWe",
        email="operador@chargegrid.demo",
        password_hash=hash_password("chargegrid123"),
        role=Role.operator,
    )
    driver = User(
        name="Motorista Demo",
        email="motorista@chargegrid.demo",
        password_hash=hash_password("chargegrid123"),
        role=Role.driver,
    )
    db.add_all([operator, driver])
    db.flush()

    db.add(Vehicle(user_id=driver.id, plate="CGD1A23", model="EV Sedan Demo"))

    comercial = Station(
        name="ChargeGrid Intelligence - Matriz",
        type=StationType.comercial,
        address="FIAP - Unidade Paulista",
        power_limit_kw=35.0,
        profile_key="chargegrid_intelligence",
    )
    residencial = Station(
        name="EV ChargeOps - Condominio Alfa",
        type=StationType.residencial,
        address="Condominio Alfa - Garagem G2",
        power_limit_kw=22.0,
        profile_key="ev_chargeops",
    )
    db.add_all([comercial, residencial])
    db.flush()

    chargers = [
        Charger(station_id=comercial.id, code="CG-01", max_power_kw=22.0, status=ChargerStatus.livre),
        Charger(station_id=comercial.id, code="CG-02", max_power_kw=11.0, status=ChargerStatus.livre),
        Charger(station_id=comercial.id, code="CG-03", max_power_kw=22.0, status=ChargerStatus.manutencao),
        Charger(station_id=residencial.id, code="EO-01", max_power_kw=11.0, status=ChargerStatus.livre),
        Charger(station_id=residencial.id, code="EO-02", max_power_kw=7.4, status=ChargerStatus.livre),
    ]
    db.add_all(chargers)
    db.commit()

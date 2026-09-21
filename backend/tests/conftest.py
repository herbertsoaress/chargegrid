import os

# IMPORTANTE: forca configuracao de teste ANTES de importar o app. Variaveis de ambiente
# vencem o arquivo .env, entao mesmo com o Supabase configurado no .env os testes
# usam SQLite em memoria e nunca encostam no banco real.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["APP_ENV"] = "development"
os.environ["SEED_DEMO_DATA"] = "true"
os.environ["ALLOW_DEMO_LOGIN"] = "true"
os.environ["OPERATOR_EMAILS"] = ""
os.environ["GOODWE_APP_ID"] = ""
os.environ["GOODWE_APP_SECRET"] = ""
# Nunca chamar o Gemini de verdade nos testes (mesmo com a chave no .env).
os.environ["GEMINI_API_KEY"] = ""
# Simuladores e protocolos: sempre desligados/limpos nos testes (o .env pode te-los ligados para a demonstracao).
# Sem isto o backend de teste subiria carregadores virtuais que conectam no servidor REAL da porta 8000.
os.environ["OCPP_SIMULATOR"] = "false"
os.environ["MODBUS_SIMULATOR"] = "false"
os.environ["OCPP_ENABLED"] = "true"
os.environ["OCPP_SHARED_TOKEN"] = ""
os.environ["PAYMENT_PROVIDER"] = "sandbox"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_demo_data  # noqa: E402


@pytest.fixture()
def db_factory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = factory()
    seed_demo_data(db)
    db.close()
    return factory


@pytest.fixture()
def client(db_factory):
    def override_get_db():
        db = db_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def login(client, email="motorista@chargegrid.demo", password="chargegrid123"):
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture()
def driver_headers(client):
    return login(client)


@pytest.fixture()
def operator_headers(client):
    return login(client, "operador@chargegrid.demo")


def free_charger_id(client, headers, code=None):
    stations = client.get("/stations").json()
    for station in stations:
        for charger in station["chargers"]:
            if charger["status"] == "livre" and (code is None or charger["code"] == code):
                return charger["id"]
    raise AssertionError("nenhum carregador livre")


def start_charging(client, headers, charger_id, mode="rapido", **extra):
    """Percorre A -> B -> C e devolve a sessao com a energia liberada."""
    created = client.post("/sessions", json={"charger_id": charger_id, "mode": mode, **extra}, headers=headers)
    assert created.status_code == 200, created.text
    sid = created.json()["id"]
    client.post(f"/sessions/{sid}/confirm-payment", headers=headers)
    client.post(f"/sessions/{sid}/authenticate-rfid", params={"approved": True}, headers=headers)
    cable = client.post(f"/sessions/{sid}/connect-cable", headers=headers)
    assert cable.status_code == 200, cable.text
    return cable.json()

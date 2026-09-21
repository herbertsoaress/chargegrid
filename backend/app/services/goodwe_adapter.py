"""Adaptador de integracao com o ecossistema GoodWe (Etapa 3 da proposta).

Regras herdadas da proposta de evolucao tecnica:
  * AppId/AppSecret e tokens da GoodWe ficam SOMENTE aqui no backend (variaveis de
    ambiente), nunca no React.
  * Enquanto a equipe nao tiver autorizacao/credenciais, o sistema usa o adaptador
    SIMULADO, que tem a MESMA interface do real. Toda resposta traz `origem`
    ("simulado" ou "real") para a interface poder identificar sem ambiguidade.
  * A integracao real comeca em modo SOMENTE LEITURA (estacoes, dispositivos,
    telemetria). Nenhum comando remoto e enviado.
  * Numeros de serie sao mascarados antes de sair do backend.

`SimulatedGoodWeAdapter` gera leituras a partir das curvas de potencia dos dois
postos do relatorio de Calculo Integral e descreve o contexto observado no SEMS+
(usina compartilhada da FIAP ~7,5 kW e um dispositivo ES ID) apenas como texto
informativo -- nao como leitura real.

`RealGoodWeAdapter` e um ESQUELETO: os caminhos em `ENDPOINTS` e o formato das
respostas NAO foram validados contra a API real (falta credencial). Depois de
receber o AppId/AppSecret, confira a documentacao oficial
(https://developers.we.goodwe.com/docs/main/overview) e ajuste so este arquivo.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from functools import cache

import httpx

from app.config import settings
from app.models import Station
from app.services.forecast import p1_curve_kw
from app.timeutil import local_hour, utcnow

FIAP_PLANT_CONTEXT = (
    "Usina compartilhada da FIAP em operacao (~7,5 kW) com um dispositivo ES ID "
    "identificado como inversor de armazenamento de energia. Confirma monitoramento "
    "de infraestrutura energetica, mas nao confirma controle de um carregador EV "
    "vinculado a conta (ver Etapa 0 da proposta de evolucao)."
)


class GoodWeIntegrationError(Exception):
    """Falha ao falar com a GoodWe (rede, credencial, resposta inesperada)."""


def mask_serial(serial: str) -> str:
    """Nunca devolve o numero de serie completo (risco 'exposicao de dados operacionais')."""
    return "****" + serial[-4:] if len(serial) > 4 else "****"


class GoodWeAdapter(ABC):
    origem: str

    @abstractmethod
    def get_status(self) -> dict:
        """Modo de operacao do adaptador (origem, modo, detalhe)."""

    @abstractmethod
    def list_plants(self) -> list[dict]:
        """Usinas/estacoes visiveis para a conta."""

    @abstractmethod
    def list_devices(self, plant_id: str | None = None) -> list[dict]:
        """Dispositivos (inversores, baterias, carregadores) da usina."""

    @abstractmethod
    def get_realtime(self, station: Station, at: datetime | None = None) -> dict:
        """Leitura instantanea de potencia (kW) e SOC (%) para a estacao."""


class SimulatedGoodWeAdapter(GoodWeAdapter):
    origem = "simulado"

    def get_status(self) -> dict:
        return {
            "origem": self.origem,
            "modo": "adaptador_simulado",
            "detalhe": (
                "Sem AppId/AppSecret da GoodWe OpenAPI configurados. Servindo dados "
                "simulados com a mesma interface do adaptador real. " + FIAP_PLANT_CONTEXT
            ),
        }

    def list_plants(self) -> list[dict]:
        return [
            {
                "id": "sim-plant-fiap",
                "name": "Usina FIAP (simulada)",
                "capacity_kw": 7.5,
                "status": "normal",
                "origem": self.origem,
            }
        ]

    def list_devices(self, plant_id: str | None = None) -> list[dict]:
        return [
            {
                "id": "sim-es-id-01",
                "type": "ES ID",
                "category": "inversor de armazenamento de energia",
                "serial_masked": mask_serial("SIM000000001"),
                "status": "online",
                "origem": self.origem,
            },
            {
                "id": "sim-ev-charger-01",
                "type": "EV Charger",
                "category": "carregador veicular (NAO confirmado na conta da FIAP)",
                "serial_masked": mask_serial("SIM000000002"),
                "status": "nao_vinculado",
                "origem": self.origem,
            },
        ]

    def get_realtime(self, station: Station, at: datetime | None = None) -> dict:
        moment = at or utcnow()
        hour = local_hour(moment)
        power_kw = round(p1_curve_kw(hour), 2)
        # SOC sintetico so para bater com o formato de resposta da GoodWe (baterias ESS)
        soc_percent = round(40 + 30 * (power_kw / 31), 1)
        return {
            "origem": self.origem,
            "station_id": station.id,
            "timestamp": moment,
            "power_kw": power_kw,
            "soc_percent": min(soc_percent, 100.0),
            "raw_json": {
                "profile_key": station.profile_key,
                "curva": "P1(t)=5+20sen(pi t/24)",
            },
        }


class RealGoodWeAdapter(GoodWeAdapter):
    origem = "real"

    # AJUSTAR conforme a documentacao oficial da GoodWe Open Platform.
    ENDPOINTS = {
        "login": "/api/v2/Common/CrossLogin",
        "plants": "/api/v2/PowerStation/GetPowerStationList",
        "devices": "/api/v2/PowerStation/GetDeviceList",
        "realtime": "/api/v2/PowerStationMonitor/QueryPowerStationMonitor",
    }

    def __init__(self, app_id: str, app_secret: str, base_url: str):
        self.app_id = app_id
        self.app_secret = app_secret
        self.base_url = base_url.rstrip("/")
        self._token: str | None = None

    def _login(self, client: httpx.Client) -> str:
        if self._token:
            return self._token
        response = client.post(
            self.base_url + self.ENDPOINTS["login"],
            json={"appId": self.app_id, "appSecret": self.app_secret},
            timeout=10,
        )
        response.raise_for_status()
        token = response.json().get("data", {}).get("token", "")
        if not token:
            raise GoodWeIntegrationError("Login na GoodWe nao retornou token (verifique AppId/AppSecret).")
        self._token = token
        return token

    def _call(self, endpoint: str, payload: dict | None = None) -> dict:
        try:
            with httpx.Client() as client:
                token = self._login(client)
                response = client.post(
                    self.base_url + self.ENDPOINTS[endpoint],
                    json=payload or {},
                    headers={"Token": token},  # somente leitura: so consultas
                    timeout=10,
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as exc:
            self._token = None  # forca novo login na proxima chamada
            raise GoodWeIntegrationError(f"Falha ao consultar a GoodWe OpenAPI ({endpoint}): {exc}") from exc

    def get_status(self) -> dict:
        return {
            "origem": self.origem,
            "modo": "goodwe_openapi",
            "detalhe": f"Credenciais configuradas para {self.base_url}. Acesso somente leitura.",
        }

    def list_plants(self) -> list[dict]:
        data = self._call("plants").get("data", {}) or {}
        return [
            {
                "id": str(p.get("id", "")),
                "name": p.get("name", ""),
                "capacity_kw": p.get("capacity", 0.0),
                "status": p.get("status", "desconhecido"),
                "origem": self.origem,
            }
            for p in data.get("list", [])
        ]

    def list_devices(self, plant_id: str | None = None) -> list[dict]:
        data = self._call("devices", {"powerStationId": plant_id}).get("data", {}) or {}
        return [
            {
                "id": str(d.get("id", "")),
                "type": d.get("type", ""),
                "category": d.get("category", ""),
                "serial_masked": mask_serial(str(d.get("sn", ""))),
                "status": d.get("status", "desconhecido"),
                "origem": self.origem,
            }
            for d in data.get("list", [])
        ]

    def get_realtime(self, station: Station, at: datetime | None = None) -> dict:
        data = self._call("realtime").get("data", {}) or {}
        return {
            "origem": self.origem,
            "station_id": station.id,
            "timestamp": at or utcnow(),
            "power_kw": float(data.get("power_kw", data.get("pac", 0.0)) or 0.0),
            "soc_percent": data.get("soc_percent", data.get("soc")),
            "raw_json": {k: v for k, v in data.items() if "sn" not in k.lower()},  # sem seriais
        }


@cache
def _real_adapter(app_id: str, app_secret: str, base_url: str) -> RealGoodWeAdapter:
    return RealGoodWeAdapter(app_id, app_secret, base_url)  # reaproveita o token entre chamadas


def get_adapter() -> GoodWeAdapter:
    if settings.goodwe_app_id and settings.goodwe_app_secret:
        return _real_adapter(settings.goodwe_app_id, settings.goodwe_app_secret, settings.goodwe_base_url)
    return SimulatedGoodWeAdapter()

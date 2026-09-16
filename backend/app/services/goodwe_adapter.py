"""Adaptador de integracao com o ecossistema GoodWe.

Conforme a Proposta de Evolucao Tecnica (secao ARQUITETURA e RISCOS): as
credenciais da GoodWe OpenAPI (AppId/AppSecret) nunca chegam ao frontend, e
enquanto a equipe nao tiver autorizacao/credenciais reais concedidas pela
FIAP/GoodWe, o sistema deve usar um adaptador simulado com a MESMA interface,
deixando explicito em toda resposta qual e a origem do dado ("simulado" ou
"real") -- isso evita a ambiguidade que o documento pede para eliminar.

`SimulatedGoodWeAdapter` gera leituras a partir das curvas de potencia dos
dois postos documentados no relatorio de Calculo Integral, e descreve o
contexto observado no acesso da equipe ao SEMS+ (usina compartilhada da FIAP,
~7,5 kW, e um dispositivo ES ID de inversor de armazenamento) apenas como
texto informativo -- nao como leitura real de telemetria.

`RealGoodWeAdapter` e um esqueleto de cliente httpx para a GoodWe Open
Platform (login via AppId/AppSecret -> token, depois consultas somente
leitura de estacoes/dispositivos). So e usado quando GOODWE_APP_ID e
GOODWE_APP_SECRET estao definidos no ambiente; caso contrario o factory
`get_adapter()` sempre retorna o simulado.
"""

from abc import ABC, abstractmethod
from datetime import datetime

import httpx

from app.config import settings
from app.models import Station, StationType
from app.services.pricing import power_curve_kw

FIAP_PLANT_CONTEXT = (
    "Usina compartilhada da FIAP em operacao (~7,5 kW) com um dispositivo ES ID "
    "identificado como inversor de armazenamento de energia. Confirma monitoramento "
    "de infraestrutura energetica, mas nao confirma controle de um carregador EV "
    "vinculado a conta (ver Etapa 0 da proposta de evolucao)."
)


class GoodWeAdapter(ABC):
    @abstractmethod
    def get_status(self) -> dict:
        """Modo de operacao do adaptador (origem, modo, detalhe)."""

    @abstractmethod
    def get_realtime(self, station: Station, at: datetime | None = None) -> dict:
        """Leitura instantanea de potencia (kW) e SOC (%) para a estacao."""


class SimulatedGoodWeAdapter(GoodWeAdapter):
    def get_status(self) -> dict:
        return {
            "origem": "simulado",
            "modo": "adaptador_simulado",
            "detalhe": (
                "Sem AppId/AppSecret da GoodWe OpenAPI configurados. Servindo dados "
                "simulados com a mesma interface do adaptador real. " + FIAP_PLANT_CONTEXT
            ),
        }

    def get_realtime(self, station: Station, at: datetime | None = None) -> dict:
        moment = at or datetime.utcnow()
        hour = moment.hour + moment.minute / 60
        station_type = station.type
        power_kw = round(power_curve_kw(station_type, hour), 2)
        # SOC sintetico so para bater com o formato de resposta da GoodWe (baterias ESS)
        soc_percent = round(40 + 30 * (power_kw / 31), 1)
        return {
            "origem": "simulado",
            "station_id": station.id,
            "timestamp": moment,
            "power_kw": power_kw,
            "soc_percent": min(soc_percent, 100.0),
            "raw_json": {
                "profile_key": station.profile_key,
                "curva": "P1(t)=5+20sen(pi t/24)" if station_type == StationType.comercial else "P2(t)=16+15cos(pi(t-20)/12)",
            },
        }


class RealGoodWeAdapter(GoodWeAdapter):
    """Esqueleto para a GoodWe Open Platform (https://developers.we.goodwe.com).

    Fluxo esperado (nao validado contra a API real por falta de credenciais):
    1. POST {base_url}/api/v2/Common/CrossLogin com AppId/AppSecret -> token.
    2. GET {base_url}/api/PowerStationMonitor/... com o token no header, somente leitura.
    """

    def __init__(self, app_id: str, app_secret: str, base_url: str):
        self.app_id = app_id
        self.app_secret = app_secret
        self.base_url = base_url.rstrip("/")

    def _login(self, client: httpx.Client) -> str:
        response = client.post(
            f"{self.base_url}/api/v2/Common/CrossLogin",
            json={"appId": self.app_id, "appSecret": self.app_secret},
            timeout=10,
        )
        response.raise_for_status()
        return response.json().get("data", {}).get("token", "")

    def get_status(self) -> dict:
        return {
            "origem": "real",
            "modo": "goodwe_openapi",
            "detalhe": f"Credenciais configuradas para {self.base_url}. Acesso somente leitura.",
        }

    def get_realtime(self, station: Station, at: datetime | None = None) -> dict:
        try:
            with httpx.Client() as client:
                token = self._login(client)
                headers = {"Token": token}
                response = client.get(
                    f"{self.base_url}/api/PowerStationMonitor/QueryPowerStationMonitor",
                    headers=headers,
                    timeout=10,
                )
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            return {
                "origem": "real",
                "station_id": station.id,
                "timestamp": at or datetime.utcnow(),
                "power_kw": 0.0,
                "soc_percent": None,
                "raw_json": {"erro": f"Falha ao consultar GoodWe OpenAPI: {exc}"},
            }
        return {
            "origem": "real",
            "station_id": station.id,
            "timestamp": at or datetime.utcnow(),
            "power_kw": data.get("power_kw", 0.0),
            "soc_percent": data.get("soc_percent"),
            "raw_json": data,
        }


def get_adapter() -> GoodWeAdapter:
    if settings.goodwe_app_id and settings.goodwe_app_secret:
        return RealGoodWeAdapter(settings.goodwe_app_id, settings.goodwe_app_secret, settings.goodwe_base_url)
    return SimulatedGoodWeAdapter()

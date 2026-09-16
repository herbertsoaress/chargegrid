"""Assistente IA do console do operador.

Responde com base em regras sobre agregados reais do banco (sem depender de
chave de LLM externa). Cobre as quatro categorias vistas no site publicado:
manutencao, faturamento, sessoes e carga da rede.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import Charger, ChargerStatus, ChargingSession, Station
from app.routers.sessions import MODE_FACTOR
from app.schemas import AssistantAnswer, AssistantQuery
from app.services.goodwe_adapter import get_adapter

router = APIRouter(prefix="/assistant", tags=["assistant"])


def _classify(question: str) -> str:
    q = question.lower()
    if any(k in q for k in ["manuten", "bypass", "trava", "manutenção"]):
        return "manutencao"
    if any(k in q for k in ["fatur", "receita", "r$", "preco", "preço", "tarifa"]):
        return "faturamento"
    if any(k in q for k in ["sessao", "sessão", "carreg", "motorista", "carro"]):
        return "sessoes"
    if any(k in q for k in ["rede", "capacidade", "kw", "carga", "goodwe", "sems"]):
        return "carga_rede"
    return "geral"


@router.post("/query", response_model=AssistantAnswer)
def query_assistant(payload: AssistantQuery, db: DbSession = Depends(get_db)):
    category = _classify(payload.question)

    if category == "manutencao":
        in_bypass = db.query(ChargingSession).filter(ChargingSession.maintenance_bypass.is_(True), ChargingSession.ended_at.is_(None)).count()
        in_manutencao = db.query(Charger).filter(Charger.status == ChargerStatus.manutencao).count()
        answer = (
            f"{in_manutencao} carregador(es) em manutencao e {in_bypass} sessao(oes) ativa(s) com bypass "
            "de manutencao acionado. Bypass de manutencao tem prioridade sobre a trava de seguranca "
            "independentemente do estado comercial (S ou T ja liberados via M=1)."
        )
    elif category == "faturamento":
        ended = db.query(ChargingSession).filter(ChargingSession.ended_at.isnot(None)).all()
        revenue = round(sum(s.amount_due for s in ended), 2)
        answer = (
            f"Faturamento acumulado registrado no banco: R$ {revenue:.2f} em {len(ended)} sessao(oes) encerrada(s). "
            "A tarifa por kWh varia por horario e por tipo de posto (comercial x residencial) -- "
            "consulte /billing/pricing para a curva completa."
        )
    elif category == "sessoes":
        active = db.query(ChargingSession).filter(ChargingSession.ended_at.is_(None)).all()
        answer = (
            f"{len(active)} sessao(oes) ativa(s) agora. Estados possiveis: aguardando pagamento, "
            "aguardando RFID, aguardando conexao do cabo, carregando e finalizada (cabo liberado)."
        )
    elif category == "carga_rede":
        adapter = get_adapter()
        status = adapter.get_status()
        stations = db.query(Station).count()
        answer = (
            f"Adaptador GoodWe em modo '{status['modo']}' (origem: {status['origem']}). "
            f"{stations} estacao(oes) cadastrada(s). {status['detalhe']}"
        )
    else:
        answer = (
            "Posso responder sobre manutencao/bypass, faturamento, sessoes de recarga ou carga da rede/GoodWe. "
            "Pergunte, por exemplo: 'qual o faturamento de hoje?' ou 'quantas sessoes estao ativas?'."
        )

    return AssistantAnswer(answer=answer, category=category)

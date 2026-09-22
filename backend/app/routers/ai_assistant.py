"""Assistente IA -- usado no console do operador e no widget flutuante do app do motorista.

Dois modos, escolhidos automaticamente:
  * IA (Gemini): quando GEMINI_API_KEY esta no .env E quem pergunta esta logado. O modelo
    recebe as regras (services/llm.py) e um contexto do banco filtrado pelo papel do usuario.
  * Regras: sem chave, sem login, limite por minuto atingido ou qualquer falha da IA.
    Responde por palavras-chave sobre os dados reais do banco (funciona sem internet).

O campo `origem` da resposta ("ia" | "regras") diz qual dos dois respondeu. Quando a
pergunta chega com token de motorista, as respostas ficam restritas aos dados dele.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import Charger, ChargerStatus, ChargingSession, Role, Station, User
from app.schemas import AssistantAnswer, AssistantQuery
from app.security import get_current_user_optional
from app.config import settings
from app.services.goodwe_adapter import get_adapter
from app.services.integration_log import log_integration
from app.services.llm import LLMError, allow_llm_call, ask_llm, build_context
from app.services.pricing import live_energy_and_amount

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["assistant"])


def _classify(question: str) -> str:
    q = question.lower()
    if any(k in q for k in ["minha sessao", "minha sessão", "meu carregamento", "quanto falta", "quando termina", "status da minha"]):
        return "minha_sessao"
    if any(k in q for k in ["modo", "rapido", "rápido", "economico", "econômico", "sustentavel", "sustentável"]):
        return "modos"
    if any(k in q for k in ["manuten", "bypass", "trava"]):
        return "manutencao"
    if any(k in q for k in ["fatur", "receita", "r$", "preco", "preço", "tarifa", "pagar", "pagamento", "gastei", "gasto"]):
        return "faturamento"
    if any(k in q for k in ["sessao", "sessão", "carreg", "motorista", "carro"]):
        return "sessoes"
    if any(k in q for k in ["rede", "capacidade", "kw", "carga", "goodwe", "sems"]):
        return "carga_rede"
    return "geral"


@router.post("/query", response_model=AssistantAnswer)
def query_assistant(
    payload: AssistantQuery,
    db: DbSession = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    category = _classify(payload.question)

    # A IA so responde a quem esta logado (evita gastar a cota da chave com anonimos).
    if settings.ai_enabled and user is not None and allow_llm_call(user.id):
        try:
            answer = ask_llm(
                payload.question,
                build_context(db, user, payload.screen_snapshot),
                [turn.model_dump() for turn in payload.history],
            )
            return AssistantAnswer(answer=answer, category=category, origem="ia", modelo=settings.gemini_model)
        except LLMError as exc:
            logger.warning("Assistente: IA indisponivel, usando regras (%s)", exc)
            log_integration(db, "gemini", "WARN", f"IA indisponivel, resposta por regras: {exc}")

    return _rule_based_answer(category, db, user)


def _rule_based_answer(category: str, db: DbSession, user: User | None) -> AssistantAnswer:
    is_driver = user is not None and user.role == Role.driver

    if category == "minha_sessao":
        if not is_driver:
            answer = "Essa pergunta e sobre a sua sessao de recarga -- entre com uma conta de motorista para eu consultar os detalhes."
        else:
            session = (
                db.query(ChargingSession)
                .filter(ChargingSession.user_id == user.id)
                .order_by(ChargingSession.started_at.desc())
                .first()
            )
            if not session:
                answer = "Voce ainda nao iniciou nenhuma sessao de recarga. Escolha uma estacao na aba Estacoes para comecar."
            else:
                energy, amount = live_energy_and_amount(session)
                if session.ended_at:
                    answer = (
                        f"Sua ultima sessao (#{session.id}) ja foi encerrada: {energy:.2f} kWh entregues, "
                        f"total de R$ {amount:.2f} (energia a R$ {session.price_per_kwh_snapshot:.2f}/kWh, "
                        "mais tempo de uso e eventual ociosidade)."
                    )
                elif session.power_released:
                    answer = (
                        f"Sua sessao #{session.id} esta '{session.status.replace('_', ' ')}', modo {session.mode.value}. "
                        f"Estimativa ate agora: {energy:.2f} kWh (~R$ {amount:.2f})."
                    )
                else:
                    answer = (
                        f"Sua sessao #{session.id} esta '{session.status.replace('_', ' ')}'. "
                        "A energia so e liberada depois de confirmar o pagamento, autenticar o RFID e conectar o cabo."
                    )
    elif category == "modos":
        answer = (
            "Rapido: usa a potencia maxima do carregador -- a recarga mais veloz, e tambem a mais cara no "
            "horario de pico. Economico: cerca de 55% da potencia maxima, para quem nao tem pressa e quer "
            "economizar. Sustentavel: cerca de 75% da potencia, um meio-termo entre velocidade e eficiencia."
        )
    elif category == "manutencao":
        in_bypass = (
            db.query(ChargingSession)
            .filter(ChargingSession.maintenance_bypass.is_(True), ChargingSession.ended_at.is_(None))
            .count()
        )
        in_manutencao = db.query(Charger).filter(Charger.status == ChargerStatus.manutencao).count()
        answer = (
            f"{in_manutencao} carregador(es) em manutencao e {in_bypass} sessao(oes) ativa(s) com bypass "
            "de manutencao acionado pelo operador. Bypass de manutencao tem prioridade sobre a trava de "
            "seguranca, independentemente do estado comercial."
        )
    elif category == "faturamento":
        if is_driver:
            ended = (
                db.query(ChargingSession)
                .filter(ChargingSession.user_id == user.id, ChargingSession.ended_at.isnot(None))
                .all()
            )
            total = round(sum(s.amount_due for s in ended), 2)
            answer = (
                f"Voce ja gastou R$ {total:.2f} em {len(ended)} sessao(oes) encerrada(s). O pagamento e feito "
                "em ambiente sandbox (PIX ou Cartao) ao final de cada sessao; o preco por kWh varia conforme "
                "o horario e a demanda prevista para a rede."
            )
        else:
            ended = db.query(ChargingSession).filter(ChargingSession.ended_at.isnot(None)).all()
            revenue = round(sum(s.amount_due for s in ended), 2)
            answer = (
                f"Faturamento acumulado registrado no banco: R$ {revenue:.2f} em {len(ended)} sessao(oes) "
                "encerrada(s). A tarifa por kWh varia por horario e demanda prevista -- consulte "
                "/billing/pricing para a curva completa."
            )
    elif category == "sessoes":
        if is_driver:
            active = (
                db.query(ChargingSession)
                .filter(ChargingSession.user_id == user.id, ChargingSession.ended_at.is_(None))
                .count()
            )
            total = db.query(ChargingSession).filter(ChargingSession.user_id == user.id).count()
            answer = f"Voce tem {active} sessao(oes) em andamento, de um total de {total} realizada(s) por voce."
        else:
            active = db.query(ChargingSession).filter(ChargingSession.ended_at.is_(None)).all()
            answer = (
                f"{len(active)} sessao(oes) ativa(s) agora na rede. Estados possiveis: aguardando pagamento, "
                "aguardando RFID, aguardando conexao do cabo, carregando e finalizada (cabo liberado)."
            )
    elif category == "carga_rede":
        adapter = get_adapter()
        goodwe_status = adapter.get_status()
        stations = db.query(Station).count()
        answer = (
            f"Adaptador GoodWe em modo '{goodwe_status['modo']}' (origem: {goodwe_status['origem']}). "
            f"{stations} estacao(oes) cadastrada(s). {goodwe_status['detalhe']}"
        )
    elif is_driver:
        answer = (
            "Posso responder sobre a sua sessao atual, os modos de recarga (rapido, economico, sustentavel), "
            "pagamento e seu historico. Pergunte, por exemplo: 'status da minha sessao' ou 'quanto ja gastei?'."
        )
    else:
        answer = (
            "Posso responder sobre manutencao/bypass, faturamento, sessoes de recarga ou carga da rede/GoodWe. "
            "Pergunte, por exemplo: 'qual o faturamento de hoje?' ou 'quantas sessoes estao ativas?'."
        )

    return AssistantAnswer(answer=answer, category=category, origem="regras")

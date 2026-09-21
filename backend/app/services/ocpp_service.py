"""Regras de negocio do OCPP 1.6J: o que cada mensagem do carregador faz no ChargeGrid.

Este modulo NAO fala rede: recebe valores ja lidos da mensagem e mexe no banco (sincrono, testavel).
O transporte WebSocket fica em `ocpp_csms.py`. As mesmas regras da sessao valem para o REST e para o
OCPP porque os dois passam por `services/session_ops.py` (maquina de estados A/B/C/D do docx da Sprint 3).

Mapa OCPP -> ChargeGrid
-----------------------
BootNotification   registra que o carregador ligou (auditoria).
StatusNotification Faulted/Unavailable -> carregador em "manutencao"; Available -> "livre".
Authorize          idTag "USR-<id do usuario>" valido => Accepted (RFID do motorista).
StartTransaction   a sessao ABERTA do motorista naquele carregador ganha B (RFID) e C (cabo); se A
                   (pagamento pre-autorizado) ja esta ok, a energia e liberada (S = 1).
                   Sem sessao => Invalid; sem pagamento pre-autorizado => Blocked.
MeterValues        Energy.Active.Import.Register / Power.Active.Import / SoC viram a telemetria da sessao.
StopTransaction    registra o fim; se a trava ja esta liberada (D = 1) encerra a sessao e libera o carregador.
"""

import json
from datetime import timedelta

from sqlalchemy.orm import Session as DbSession

from app.models import (
    Charger,
    ChargerStatus,
    ChargingSession,
    OcppMessage,
    Role,
    User,
)
from app.services import session_ops
from app.services.integration_log import log_integration
from app.services.session_ops import SessionOpError
from app.services.simulator import nominal_power_kw
from app.timeutil import utcnow

ID_TAG_PREFIX = "USR-"
FAULT_STATUSES = {"Faulted", "Unavailable"}
MAX_PAYLOAD_CHARS = 4000  # quadros maiores (raros) ficam resumidos no log

ACCEPTED, INVALID, BLOCKED = "Accepted", "Invalid", "Blocked"


def id_tag_for_user(user_id: int) -> str:
    """idTag do "cartao RFID" do motorista (o carregador virtual usa este valor no Authorize)."""
    return f"{ID_TAG_PREFIX}{user_id}"


def _user_from_tag(db: DbSession, id_tag: str) -> User | None:
    if not id_tag.startswith(ID_TAG_PREFIX) or not id_tag[len(ID_TAG_PREFIX) :].isdigit():
        return None
    user = db.get(User, int(id_tag[len(ID_TAG_PREFIX) :]))
    return user if user and user.role == Role.driver else None


def get_charger(db: DbSession, code: str) -> Charger | None:
    return db.query(Charger).filter(Charger.code == code).first()


def open_session(db: DbSession, charger: Charger, user_id: int | None = None) -> ChargingSession | None:
    query = db.query(ChargingSession).filter(ChargingSession.charger_id == charger.id, ChargingSession.ended_at.is_(None))
    if user_id is not None:
        query = query.filter(ChargingSession.user_id == user_id)
    return query.order_by(ChargingSession.started_at.desc()).first()


def charger_snapshot(db: DbSession, code: str) -> dict | None:
    """Estado do carregador e da sessao aberta nele (o carregador virtual consulta isto para decidir o que fazer)."""
    charger = get_charger(db, code)
    if charger is None:
        return None
    session = open_session(db, charger)
    return {
        "charger_status": charger.status.value,
        "max_power_kw": charger.max_power_kw,
        "session": None
        if session is None
        else {
            "id": session.id,
            "user_id": session.user_id,
            "payment_confirmed": session.payment_confirmed,
            "rfid_ok": session.rfid_ok,
            "power_released": session.power_released,
            "payment_finalized": session.payment_finalized,
            "nominal_power_kw": nominal_power_kw(session),
            "current_pct": session.current_pct,
        },
    }


# ---------------------------------------------------------------- log dos quadros
def log_frame(db: DbSession, code: str, direction: str, raw: str, pending: dict[str, str]) -> None:
    """Guarda um quadro OCPP bruto. `pending` liga o id de um CALL a sua acao para nomear o CALLRESULT."""
    try:
        frame = json.loads(raw)
        message_type = int(frame[0])
        unique_id = str(frame[1])
    except (ValueError, IndexError, TypeError):
        db.add(OcppMessage(charge_point_id=code, direction=direction, message_type=0, payload_json={"raw": raw[:500]}))
        db.commit()
        return

    if message_type == 2:  # CALL: [2, id, acao, payload]
        action, payload = str(frame[2]), frame[3] if len(frame) > 3 else {}
        pending[unique_id] = action
    elif message_type == 3:  # CALLRESULT: [3, id, payload]
        action, payload = pending.pop(unique_id, ""), frame[2] if len(frame) > 2 else {}
    else:  # CALLERROR: [4, id, codigo, descricao, detalhes]
        action = pending.pop(unique_id, "")
        payload = {"codigo": frame[2] if len(frame) > 2 else "", "descricao": frame[3] if len(frame) > 3 else ""}

    if len(json.dumps(payload, default=str)) > MAX_PAYLOAD_CHARS:
        payload = {"resumo": "payload grande demais para o log"}
    db.add(
        OcppMessage(
            charge_point_id=code,
            direction=direction,
            message_type=message_type,
            action=action,
            unique_id=unique_id,
            payload_json=payload if isinstance(payload, dict) else {"valor": payload},
        )
    )
    db.commit()


def prune_old_messages(db: DbSession, retention_days: int) -> int:
    cutoff = utcnow() - timedelta(days=retention_days)
    deleted = db.query(OcppMessage).filter(OcppMessage.created_at < cutoff).delete()
    db.commit()
    return deleted


# ---------------------------------------------------------------- mensagens do carregador
def on_boot(db: DbSession, code: str, vendor: str, model: str, firmware: str | None = None) -> None:
    detail = f" (firmware {firmware})" if firmware else ""
    log_integration(db, "ocpp", "INFO", f"{code} ligou: BootNotification {vendor} {model}{detail}")


def on_status(db: DbSession, code: str, connector_id: int, status: str, error_code: str) -> None:
    charger = get_charger(db, code)
    if charger is None or connector_id not in (0, 1):  # so o conector 1 (e o 0 = carregador inteiro) mexe no status
        return
    if status in FAULT_STATUSES:
        if charger.status != ChargerStatus.manutencao:
            charger.status = ChargerStatus.manutencao
            db.commit()
            log_integration(db, "ocpp", "WARN", f"{code} indisponivel: StatusNotification {status} ({error_code})")
    elif status == "Available":
        if open_session(db, charger) is None and charger.status != ChargerStatus.livre:
            charger.status = ChargerStatus.livre
            db.commit()
    elif charger.status == ChargerStatus.manutencao:  # voltou a operar (Preparing, Charging...)
        charger.status = ChargerStatus.ocupado if open_session(db, charger) else ChargerStatus.livre
        db.commit()


def on_authorize(db: DbSession, id_tag: str) -> str:
    return ACCEPTED if _user_from_tag(db, id_tag) else INVALID


def on_start(db: DbSession, code: str, id_tag: str, meter_start_wh: int, connector_id: int = 1) -> tuple[int, str]:
    """Devolve (transactionId, status). transactionId = id da sessao no banco."""
    charger = get_charger(db, code)
    user = _user_from_tag(db, id_tag)
    session = open_session(db, charger, user.id) if charger and user else None
    if session is None:
        return 0, INVALID
    if not session.payment_confirmed:  # A: o motorista ainda nao pre-autorizou o pagamento no app
        session_ops.log_event(
            db, session, "ocpp_start_blocked", {"motivo": "pagamento ainda nao pre-autorizado", "id_tag": id_tag}, "ocpp"
        )
        db.commit()
        return session.id, BLOCKED
    try:
        session_ops.set_rfid(db, session, True, source="ocpp")
        session_ops.connect_cable(db, session, source="ocpp")
    except SessionOpError:
        db.rollback()
        return session.id, BLOCKED
    session_ops.log_event(
        db, session, "ocpp_start_transaction", {"meter_start_wh": meter_start_wh, "connector_id": connector_id}, "ocpp"
    )
    db.commit()
    return session.id, ACCEPTED


def _meter_start_wh(session: ChargingSession) -> float:
    for event in session.events:
        if event.type == "ocpp_start_transaction":
            return float(event.payload_json.get("meter_start_wh", 0))
    return 0.0


def parse_samples(meter_values: list[dict]) -> dict:
    """Extrai energia (kWh), potencia (kW) e SoC (%) das amostras de um MeterValues (aceita snake_case e camelCase)."""
    out: dict = {}
    for entry in meter_values or []:
        for sample in entry.get("sampled_value", entry.get("sampledValue", [])):
            try:
                value = float(sample.get("value"))
            except (TypeError, ValueError):
                continue
            measurand = sample.get("measurand", "Energy.Active.Import.Register")
            unit = sample.get("unit", "Wh")
            if measurand == "Energy.Active.Import.Register":
                out["energy_wh"] = value * (1000 if unit == "kWh" else 1)
            elif measurand == "Power.Active.Import":
                out["power_kw"] = value / 1000 if unit == "W" else value
            elif measurand == "SoC":
                out["soc_pct"] = value
    return out


def on_meter(db: DbSession, code: str, transaction_id: int | None, meter_values: list[dict]) -> bool:
    """Aplica a telemetria a sessao. False = ignorada (sem sessao, ja paga ou encerrada)."""
    charger = get_charger(db, code)
    session = db.get(ChargingSession, transaction_id) if transaction_id else None
    if charger is None or session is None or session.charger_id != charger.id:
        return False
    samples = parse_samples(meter_values)
    if "energy_wh" not in samples:
        return False
    energy_kwh = max(0.0, (samples["energy_wh"] - _meter_start_wh(session)) / 1000)
    try:
        session_ops.report_meter(
            db, session, energy_kwh, samples.get("power_kw", session.current_power_kw), samples.get("soc_pct"), source="ocpp"
        )
    except SessionOpError:  # pagamento ja finalizado / sessao encerrada: leitura tardia, ignora
        db.rollback()
        return False
    db.commit()
    return True


def on_stop(db: DbSession, code: str, transaction_id: int, meter_stop_wh: int, reason: str | None) -> None:
    charger = get_charger(db, code)
    session = db.get(ChargingSession, transaction_id) if transaction_id else None
    if charger is None or session is None or session.charger_id != charger.id:
        return
    session_ops.log_event(
        db,
        session,
        "ocpp_stop_transaction",
        {"meter_stop_wh": meter_stop_wh, "reason": reason or "Local"},
        "ocpp",
    )
    if session.ended_at is None and session.lock_released:  # D = 1: pode encerrar e liberar o carregador
        try:
            session_ops.stop(db, session, source="ocpp")
        except SessionOpError:
            db.rollback()
    db.commit()

"""Operacoes da jornada da sessao, sem HTTP: usadas pelo REST (app do motorista) e pelo OCPP (carregador).

Assim os DOIS caminhos passam exatamente pelas mesmas regras da maquina de estados
(services/session_fsm.py): RFID -> cabo -> telemetria -> encerramento. Quem chama faz o commit.
"""

from sqlalchemy.orm import Session as DbSession

from app.models import ChargerStatus, ChargingSession, PaymentStatus, SessionEvent
from app.services import payments, pricing, session_fsm
from app.services.simulator import soc_from_energy
from app.timeutil import utcnow

METER_EVENT_MIN_INTERVAL_S = 30  # evita uma linha de evento a cada leitura de medidor


class SessionOpError(Exception):
    """A operacao nao e permitida no estado atual da sessao (o REST vira HTTP 409)."""

    def __init__(self, detail: str, status: int = 409):
        super().__init__(detail)
        self.detail = detail
        self.status = status


def log_event(db: DbSession, session: ChargingSession, event_type: str, payload: dict, source: str = "rest") -> None:
    """Grava um evento da sessao. `source` = "ocpp" marca o que veio do carregador (o REST nao muda o payload)."""
    if source != "rest":
        payload = {**payload, "source": source}
    db.add(SessionEvent(session_id=session.id, type=event_type, payload_json=payload))


def _require_open(session: ChargingSession) -> None:
    if session.ended_at:
        raise SessionOpError("Sessao ja encerrada")


def set_rfid(db: DbSession, session: ChargingSession, approved: bool, source: str = "rest") -> None:
    """B: autenticacao RFID."""
    _require_open(session)
    session.rfid_ok = approved
    result = session_fsm.authenticate_rfid(approved)
    log_event(db, session, result.event_type, result.payload, source)


def connect_cable(db: DbSession, session: ChargingSession, source: str = "rest") -> None:
    """C: cabo engatado. Com A (pagamento) e B (RFID) ja confirmados a energia e liberada (S = 1)."""
    _require_open(session)
    if not (session.payment_confirmed and session.rfid_ok):
        raise SessionOpError("Pagamento e autenticacao RFID precisam estar confirmados antes de engatar o cabo")
    session.cable_connected = True
    if session.charging_started_at is None:
        session.charging_started_at = utcnow()
    result = session_fsm.connect_cable()
    log_event(db, session, result.event_type, result.payload, source)


def mark_full_if_needed(session: ChargingSession, at) -> None:
    """Registra o instante em que a bateria chegou a 100% pela 1a vez (para contar ociosidade).
    Chamado sempre que o SoC e atualizado -- pela telemetria (OCPP ou app) ou no encerramento."""
    if session.full_at is None and session.current_pct >= 100.0:
        session.full_at = at


def report_meter(
    db: DbSession,
    session: ChargingSession,
    energy_kwh: float,
    power_kw: float,
    soc_pct: float | None = None,
    source: str = "rest",
) -> None:
    """Telemetria do carregador (MeterValues)."""
    _require_open(session)
    if not session.power_released:
        raise SessionOpError("Energia ainda nao foi liberada para esta sessao")
    if session.payment_finalized:
        raise SessionOpError("Pagamento ja finalizado; medicao encerrada")

    now = utcnow()
    first_reading = session.last_meter_at is None
    session.energy_kwh = round(max(energy_kwh, session.energy_kwh), 3)  # medidor nunca anda para tras
    session.current_power_kw = power_kw
    session.current_pct = soc_pct if soc_pct is not None else soc_from_energy(session.energy_kwh)
    mark_full_if_needed(session, now)
    if first_reading or (now - session.last_meter_at).total_seconds() >= METER_EVENT_MIN_INTERVAL_S:
        log_event(
            db,
            session,
            "meter_values",
            {"energy_kwh": session.energy_kwh, "power_kw": power_kw, "soc_pct": session.current_pct},
            source,
        )
    session.last_meter_at = now


def stop(db: DbSession, session: ChargingSession, source: str = "rest") -> None:
    """Encerra a sessao e libera o carregador (so com a trava liberada: T = 1)."""
    _require_open(session)
    if not session.lock_released:
        raise SessionOpError(
            "Trava do cabo ainda bloqueada: finalize o pagamento (ou acione bypass de manutencao) antes de encerrar"
        )
    session.ended_at = utcnow()
    session.current_power_kw = 0.0
    session.charger.status = ChargerStatus.livre
    mark_full_if_needed(session, session.ended_at)  # se a ultima leitura ja marcava 100% mas ninguem registrou
    _settle_final_amount(db, session, source)
    log_event(db, session, "session_stopped", {"energy_kwh": session.energy_kwh, "amount_due": session.amount_due}, source)


def _settle_final_amount(db: DbSession, session: ChargingSession, source: str) -> None:
    """Confere o valor com a energia e o tempo FINAIS (energia + tempo de uso + ociosidade, com o
    teto por kWh). O pagamento e calculado no instante em que foi feito; uma leitura do medidor que
    ainda estava a caminho, ou o tempo parado apos a bateria encher, pode mudar o valor depois (o
    cabo so trava/destrava com o pagamento, mas o carregador segue medindo ate o StopTransaction)."""
    if not session.payment_finalized:  # encerramento por bypass de manutencao: nada foi cobrado
        return
    final = pricing.breakdown(session, session.ended_at).total
    if final == session.amount_due:
        return
    previous = session.amount_due
    session.amount_due = final
    approved = next((p for p in session.payments if p.status == PaymentStatus.aprovado), None)
    reconcile = False
    if approved is not None:
        if payments.get_provider().real:
            reconcile = True  # provedor real: nao mexemos no que foi cobrado; a diferenca fica registrada
        else:
            approved.amount = final
    log_event(
        db,
        session,
        "amount_adjusted",
        {"previous": previous, "final": final, "energy_kwh": session.energy_kwh, "to_reconcile": reconcile},
        source,
    )

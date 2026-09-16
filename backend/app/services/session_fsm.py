"""Maquina de estados da sessao de recarga.

Implementa literalmente o modelo booleano validado em
`Sprint3_ChargeGrid_ComputerScience.docx` (ChargeGrid Auth System / ESP32):

    A = confirmacao de pagamento (pre-autorizacao via API)
    B = autenticacao RFID
    C = engate fisico do cabo
    M = bypass de manutencao
    D = pagamento finalizado (liquidacao)

    S (liberacao de potencia)      = A*B*C + M
    T original (liberacao da trava) = A*B*C*D + M*D + M
    T simplificado (Lei da Absorcao)= A*B*C*D + M

O relatorio prova via tabela-verdade (32/32 combinacoes) que as duas formas de T
sao equivalentes; `tests/test_session_fsm.py` reproduz essa prova.
"""

from dataclasses import dataclass


def power_released(a: bool, b: bool, c: bool, m: bool) -> bool:
    """S = A*B*C + M"""
    return (a and b and c) or m


def lock_released_original(a: bool, b: bool, c: bool, m: bool, d: bool) -> bool:
    """T = A*B*C*D + M*D + M (forma original, antes da simplificacao)."""
    return (a and b and c and d) or (m and d) or m


def lock_released(a: bool, b: bool, c: bool, m: bool, d: bool) -> bool:
    """T = A*B*C*D + M (forma simplificada, equivalente por Lei da Absorcao)."""
    return (a and b and c and d) or m


STATUS_BYPASS = "bypass_manutencao"
STATUS_AGUARDANDO_PAGAMENTO = "aguardando_confirmacao_pagamento"
STATUS_AGUARDANDO_RFID = "aguardando_autenticacao_rfid"
STATUS_AGUARDANDO_CABO = "aguardando_conexao_cabo"
STATUS_CARREGANDO = "carregando"
STATUS_FINALIZADA = "finalizada_cabo_liberado"


def derive_status(a: bool, b: bool, c: bool, m: bool, d: bool) -> str:
    if m:
        return STATUS_BYPASS
    if not a:
        return STATUS_AGUARDANDO_PAGAMENTO
    if not b:
        return STATUS_AGUARDANDO_RFID
    if not c:
        return STATUS_AGUARDANDO_CABO
    if not d:
        return STATUS_CARREGANDO
    return STATUS_FINALIZADA


@dataclass
class TransitionResult:
    event_type: str
    payload: dict


def confirm_payment() -> TransitionResult:
    return TransitionResult("payment_confirmed", {"variavel": "A"})


def authenticate_rfid(approved: bool) -> TransitionResult:
    return TransitionResult(
        "rfid_authenticated" if approved else "rfid_denied", {"variavel": "B", "aprovado": approved}
    )


def connect_cable() -> TransitionResult:
    return TransitionResult("cable_connected", {"variavel": "C"})


def enable_maintenance_bypass() -> TransitionResult:
    return TransitionResult("maintenance_bypass_enabled", {"variavel": "M"})


def finalize_payment() -> TransitionResult:
    return TransitionResult("payment_finalized", {"variavel": "D"})

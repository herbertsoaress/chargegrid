"""Reproduz a prova de equivalencia por tabela-verdade do
Sprint3_ChargeGrid_ComputerScience.docx: as 32 combinacoes de A,B,C,M,D devem
produzir o mesmo T pela formula original (A*B*C*D + M*D + M) e pela forma
simplificada (A*B*C*D + M), provada via Lei da Absorcao.
"""

from itertools import product

import pytest

from app.services.session_fsm import (
    derive_status,
    lock_released,
    lock_released_original,
    power_released,
)

ALL_COMBINATIONS = list(product([False, True], repeat=5))  # A, B, C, M, D


@pytest.mark.parametrize("a,b,c,m,d", ALL_COMBINATIONS)
def test_lock_released_equivalence(a, b, c, m, d):
    assert lock_released_original(a, b, c, m, d) == lock_released(a, b, c, m, d)


def test_truth_table_has_32_rows():
    assert len(ALL_COMBINATIONS) == 32


def test_power_released_matches_boolean_model():
    # S = A*B*C + M
    assert power_released(True, True, True, False) is True
    assert power_released(True, True, False, False) is False
    assert power_released(False, False, False, True) is True


def test_maintenance_bypass_overrides_everything():
    assert power_released(False, False, False, True) is True
    assert lock_released(False, False, False, True, False) is True
    assert derive_status(False, False, False, True, False) == "bypass_manutencao"


def test_status_progression_without_bypass():
    assert derive_status(False, False, False, False, False) == "aguardando_confirmacao_pagamento"
    assert derive_status(True, False, False, False, False) == "aguardando_autenticacao_rfid"
    assert derive_status(True, True, False, False, False) == "aguardando_conexao_cabo"
    assert derive_status(True, True, True, False, False) == "carregando"
    assert derive_status(True, True, True, False, True) == "finalizada_cabo_liberado"

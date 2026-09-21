from datetime import datetime

from app.timeutil import local_hour, local_midnight_utc


def test_local_hour_uses_sao_paulo_not_utc():
    # 15:00 UTC = 12:00 em Brasilia (UTC-3, sem horario de verao desde 2019)
    assert local_hour(datetime(2026, 9, 18, 15, 0)) == 12.0
    assert local_hour(datetime(2026, 9, 18, 23, 30)) == 20.5  # 23h30 em UTC = 20h30 em Brasilia


def test_local_hour_crosses_midnight_backwards():
    assert local_hour(datetime(2026, 9, 18, 1, 0)) == 22.0  # ainda "ontem a noite" no Brasil


def test_local_midnight_utc_is_3am_utc_for_brazil():
    # 14:00 UTC do dia 18 = 11:00 local do dia 18 -> meia-noite local = 03:00 UTC do dia 18
    assert local_midnight_utc(datetime(2026, 9, 18, 14, 0)) == datetime(2026, 9, 18, 3, 0)
    # 02:00 UTC do dia 18 = 23:00 local do dia 17 -> "hoje" ainda e dia 17
    assert local_midnight_utc(datetime(2026, 9, 18, 2, 0)) == datetime(2026, 9, 17, 3, 0)

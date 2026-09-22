-- ChargeGrid: tarifacao por tempo de uso e por potencia (extensao aprovada pelo grupo, fora do
-- playbook e da proposta original -- ver docs/ETAPA_5_PROPOSTA.md).
--
-- Acrescenta as tarifas TRAVADAS na sessao (snapshot na abertura, iguais as de backend/app/config.py
-- no momento em que a sessao comeca) e o instante em que a bateria chegou a 100% (para contar
-- ociosidade). So adiciona colunas: sessoes existentes ficam com 0.0/NULL, o que o backend trata
-- como "sem tempo/potencia/ociosidade extra, sem teto" (preco so por energia, como ja era cobrado).
-- Idempotente.
alter table public.charging_sessions
    add column if not exists mode_surcharge_snapshot     double precision not null default 0, -- R$/kWh, por modo
    add column if not exists time_rate_snapshot          double precision not null default 0, -- R$/minuto de recarga
    add column if not exists idle_rate_snapshot          double precision not null default 0, -- R$/minuto de ociosidade
    add column if not exists idle_grace_minutes_snapshot double precision not null default 0,
    add column if not exists price_cap_per_kwh_snapshot  double precision not null default 0, -- 0 = sem teto (sessoes antigas)
    add column if not exists full_at                     timestamp; -- bateria chegou a 100% (telemetria)

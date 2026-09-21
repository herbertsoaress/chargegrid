-- ChargeGrid: local unico (trilha ChargeGrid Intelligence, comercial e varejo).
--
-- Junta as estacoes "Centro", "Iguatemi" e "Paulista" em UMA estacao ("FIAP Paulista") com os
-- 8 carregadores CG-001..CG-008, e remove o posto residencial (Condominio Alfa, da trilha EV
-- ChargeOps). Cenario de referencia: 200 kW de potencia contratada (SUPOSICAO declarada).
--
-- Idempotente: pode rodar de novo sem efeito. Nao apaga carregadores que tenham sessoes.

-- 1) A estacao "Centro" vira o local unico
update public.stations
   set name = 'FIAP Paulista',
       address = 'FIAP - Unidade Paulista',
       type = 'comercial',
       power_limit_kw = 200,
       profile_key = 'chargegrid_intelligence'
 where name = 'Centro';

-- 2) Todos os carregadores CG-xxx passam para o local unico e ganham o nome "FIAP #n"
update public.chargers
   set station_id = (select id from public.stations where name = 'FIAP Paulista'),
       name = 'FIAP #' || (substr(code, 4))::int
 where code like 'CG-%'
   and exists (select 1 from public.stations where name = 'FIAP Paulista');

-- 3) Remove os carregadores do posto residencial (somente os que nunca tiveram sessao)
delete from public.chargers c
 where c.code like 'EO-%'
   and not exists (select 1 from public.charging_sessions s where s.charger_id = c.id);

-- 4) Remove as estacoes que ficaram vazias
delete from public.stations st
 where st.name in ('Iguatemi', 'Paulista', 'Condominio Alfa')
   and not exists (select 1 from public.chargers c where c.station_id = st.id);

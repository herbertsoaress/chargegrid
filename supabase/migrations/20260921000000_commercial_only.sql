-- ChargeGrid: o banco passa a aceitar so estacoes comerciais (trilha ChargeGrid Intelligence).
-- O tipo "residencial" era da trilha EV ChargeOps e do MVP antigo (Condominio Alfa), ja removidos.
-- Idempotente. Nao apaga nada: hoje existe 1 estacao, do tipo comercial.
alter table public.stations drop constraint if exists stations_type_check;
alter table public.stations add constraint stations_type_check check (type::text = 'comercial');

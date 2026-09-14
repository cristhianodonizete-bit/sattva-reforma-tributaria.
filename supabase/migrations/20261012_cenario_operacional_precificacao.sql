alter table public.pricing_premissas_comerciais add column if not exists cenario_operacional_id bigint;
create index if not exists ix_pricing_premissas_cenario on public.pricing_premissas_comerciais(cenario_operacional_id);

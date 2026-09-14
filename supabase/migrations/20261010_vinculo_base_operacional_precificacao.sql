alter table public.pricing_itens add column if not exists base_operacional_id bigint references public.pricing_base_operacional(id);
create index if not exists ix_pricing_itens_base_operacional on public.pricing_itens(base_operacional_id);

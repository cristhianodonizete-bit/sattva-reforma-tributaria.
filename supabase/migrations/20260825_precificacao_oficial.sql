-- Vínculo explícito da saída para a formação de custo.
-- NCM/NBS/descrição nunca são usados como inferência de equivalência.
alter table public.formacao_custo_itens
  add column if not exists movimento_saida_id bigint;
alter table public.formacao_custo_itens
  add column if not exists despesas_variaveis numeric not null default 0;
create index if not exists ix_formacao_custo_saida
  on public.formacao_custo_itens(empresa_id, movimento_saida_id);

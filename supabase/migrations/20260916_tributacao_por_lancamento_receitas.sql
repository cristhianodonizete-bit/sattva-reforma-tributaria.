-- Tributação anterior vinculada à receita complementar/lancamento do ERP.
-- Campos nulos significam "a resolver pela apuração", jamais valor zero.
alter table public.receitas_sem_dfe add column if not exists identificador_origem text;
alter table public.receitas_sem_dfe add column if not exists especie_questor text;
alter table public.receitas_sem_dfe add column if not exists segregacao_apuracao text;
alter table public.receitas_sem_dfe add column if not exists base_pis_cofins_atual numeric;
alter table public.receitas_sem_dfe add column if not exists pis_atual numeric;
alter table public.receitas_sem_dfe add column if not exists cofins_atual numeric;
alter table public.receitas_sem_dfe add column if not exists criterio_tributacao_atual text;
alter table public.receitas_sem_dfe add column if not exists tributacao_atual_origem text;

create index if not exists ix_receitas_sem_dfe_origem_lancamento
  on public.receitas_sem_dfe(empresa_id, competencia, identificador_origem);

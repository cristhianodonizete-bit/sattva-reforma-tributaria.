alter table public.receitas_sem_dfe add column if not exists classificacao_fiscal text;
alter table public.receitas_sem_dfe add column if not exists subtipo text;
alter table public.receitas_sem_dfe add column if not exists objeto_operacao text;
alter table public.receitas_sem_dfe add column if not exists contrato_referencia text;
alter table public.receitas_sem_dfe add column if not exists regra_atual text;
alter table public.receitas_sem_dfe add column if not exists regra_reforma text;
alter table public.receitas_sem_dfe add column if not exists status_comparabilidade text default 'PENDENTE_CLASSIFICACAO';

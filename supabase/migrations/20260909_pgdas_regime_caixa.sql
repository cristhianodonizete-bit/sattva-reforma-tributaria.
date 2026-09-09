-- Separa competência declarada no PGDAS da receita efetivamente recebida.
alter table public.empresas add column if not exists regime_reconhecimento_simples text default 'competencia';
alter table public.perfil_tributario add column if not exists receita_recebida numeric;


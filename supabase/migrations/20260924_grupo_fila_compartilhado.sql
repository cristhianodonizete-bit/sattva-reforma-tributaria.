-- Identidade global de um lote de jobs. processamento_id é local ao SQLite e
-- pode reiniciar com uma instância Render; grupo_id é a referência durável do
-- acompanhamento compartilhado. Esta migration é somente aditiva.
alter table public.jobs_carteira add column if not exists grupo_id uuid;

update public.jobs_carteira
  set grupo_id = gen_random_uuid()
  where grupo_id is null;

alter table public.jobs_carteira alter column grupo_id set default gen_random_uuid();
alter table public.jobs_carteira alter column grupo_id set not null;

create index if not exists ix_jobs_carteira_grupo_criado
  on public.jobs_carteira (grupo_id, criado_em);

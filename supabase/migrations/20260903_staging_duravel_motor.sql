-- Staging isolado da fotografia do motor. Não altera resultados ativos.
create table if not exists public.motor_fotografias_staging (
  job_id uuid primary key references public.jobs_carteira(id) on delete cascade,
  empresa_id bigint not null references public.empresas(id) on delete cascade,
  execucao_id bigint,
  status text not null default 'AGUARDANDO',
  quantidade_esperada integer not null default 0,
  resumo jsonb,
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists ix_motor_fotografias_staging_empresa_status
  on public.motor_fotografias_staging(empresa_id,status);
alter table public.motor_fotografias_staging enable row level security;

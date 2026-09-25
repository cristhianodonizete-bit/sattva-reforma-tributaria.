-- Presença do processo de fila. Estrutura aditiva: não altera dados fiscais,
-- fotografias, regras, documentos nem o histórico de execuções.
create table if not exists public.worker_heartbeats (
  worker_id text primary key,
  status text not null check (status in ('ATIVO', 'PAUSADO', 'ERRO')),
  heartbeat timestamptz not null default now(),
  iniciado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  detalhes jsonb not null default '{}'::jsonb
);

create index if not exists ix_worker_heartbeats_heartbeat
  on public.worker_heartbeats (heartbeat desc);

alter table public.worker_heartbeats enable row level security;

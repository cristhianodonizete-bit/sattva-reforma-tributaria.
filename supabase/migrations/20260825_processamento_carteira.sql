-- Acompanhamento persistido do processamento em lote da carteira.
create table if not exists public.processamentos_carteira (
  id bigint primary key,
  tipo text default 'RECALCULO',
  status text default 'AGENDADO',
  total_empresas integer default 0,
  processadas integer default 0,
  automaticas integer default 0,
  com_premissas integer default 0,
  com_excecoes integer default 0,
  bloqueadas integer default 0,
  iniciado_em timestamptz,
  concluido_em timestamptz,
  criado_em timestamptz
);
create table if not exists public.processamentos_carteira_itens (
  id bigint primary key,
  processamento_id bigint not null,
  empresa_id bigint not null,
  status text default 'AGENDADA',
  motivo text,
  itens_processados integer default 0,
  excecoes_abertas integer default 0,
  iniciado_em timestamptz,
  concluido_em timestamptz,
  unique(processamento_id, empresa_id)
);
create index if not exists ix_processamentos_carteira_itens_status on public.processamentos_carteira_itens(processamento_id,status);
alter table public.processamentos_carteira enable row level security;
alter table public.processamentos_carteira_itens enable row level security;

create table if not exists public.questor_conectores (
  id uuid primary key,
  nome text not null,
  segredo_hash text not null,
  usuario_id text not null,
  segredo_cifrado text,
  segredo_iv text,
  segredo_salt text,
  status text not null default 'ATIVO',
  ultima_conexao_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists ix_questor_conectores_usuario on public.questor_conectores(usuario_id, criado_em desc);
create table if not exists public.questor_conector_tarefas (
  id bigint primary key,
  conector_id uuid not null references public.questor_conectores(id) on delete cascade,
  empresa_id bigint,
  tipo text not null,
  payload_json text not null default '{}',
  status text not null default 'PENDENTE',
  resultado_json text,
  erro text,
  criado_em timestamptz not null default now(),
  executado_em timestamptz
);
create index if not exists ix_questor_tarefas_conector on public.questor_conector_tarefas(conector_id,id desc);
alter table public.questor_conectores enable row level security;
alter table public.questor_conector_tarefas enable row level security;

-- Monitoramento normativo: registro e governança, sem vínculo de escrita com o motor.
create table if not exists public.atualizacoes_reforma (
  id bigint generated always as identity primary key,
  titulo text not null,
  resumo text not null default '',
  fonte_nome text not null default '',
  fonte_url text not null default '',
  data_publicacao date,
  tema text not null default 'GERAL',
  impacto_potencial text not null default 'EM_ANALISE',
  modulos_afetados text not null default '',
  status text not null default 'NOVA' check (status in ('NOVA','EM_ANALISE','APLICADA','DESCARTADA')),
  observacao_analise text not null default '',
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  analisado_por uuid references auth.users(id),
  analisado_em timestamptz
);

create table if not exists public.atualizacoes_reforma_eventos (
  id bigint generated always as identity primary key,
  atualizacao_id bigint not null references public.atualizacoes_reforma(id) on delete cascade,
  acao text not null,
  usuario_id uuid references auth.users(id),
  dados_json jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists ix_atualizacoes_reforma_status on public.atualizacoes_reforma(status, data_publicacao desc, id desc);
create index if not exists ix_atualizacoes_reforma_eventos on public.atualizacoes_reforma_eventos(atualizacao_id, id desc);

alter table public.atualizacoes_reforma enable row level security;
alter table public.atualizacoes_reforma_eventos enable row level security;

create policy "atualizacoes_reforma_leitura_autenticada" on public.atualizacoes_reforma for select to authenticated using (true);
create policy "atualizacoes_reforma_eventos_leitura_autenticada" on public.atualizacoes_reforma_eventos for select to authenticated using (true);

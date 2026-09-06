-- Planejamento Tributário: estudos isolados e versionados. Nenhuma tabela operacional é alterada.
create table if not exists public.planejamento_analises (
  id bigint generated always as identity primary key, titulo text not null, descricao text,
  periodo_base_inicio date, periodo_base_fim date, periodo_projecao_inicio date, periodo_projecao_fim date,
  responsavel_id uuid references auth.users(id), criado_por uuid references auth.users(id),
  status text not null default 'RASCUNHO', versao integer not null default 1,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create table if not exists public.planejamento_analise_empresas (
  analise_id bigint not null references public.planejamento_analises(id) on delete cascade,
  empresa_id bigint not null references public.empresas(id) on delete restrict,
  incluida_consolidado boolean not null default true, ordem integer not null default 0,
  primary key (analise_id, empresa_id)
);
create table if not exists public.planejamento_snapshots (
  id bigint generated always as identity primary key, analise_id bigint not null references public.planejamento_analises(id) on delete cascade,
  versao integer not null, dados_json jsonb not null, motor_versao text, criado_em timestamptz not null default now(), unique(analise_id,versao)
);
create table if not exists public.planejamento_premissas (
  id bigint generated always as identity primary key, analise_id bigint not null references public.planejamento_analises(id) on delete cascade,
  cenario text, escopo text not null default 'ANALISE', campo text not null, valor text, tipo text not null default 'OPERACIONAL',
  origem text not null default 'PREMISSA_MANUAL', justificativa text, responsavel_id uuid references auth.users(id), criado_em timestamptz not null default now()
);
create table if not exists public.planejamento_resultados (
  id bigint generated always as identity primary key, analise_id bigint not null references public.planejamento_analises(id) on delete cascade,
  snapshot_id bigint not null references public.planejamento_snapshots(id) on delete restrict,
  cenario text not null, status text not null, confianca text not null, resultado_json jsonb not null,
  calculado_em timestamptz not null default now(), unique(analise_id,snapshot_id,cenario)
);
create table if not exists public.planejamento_eventos (
  id bigint generated always as identity primary key, analise_id bigint not null references public.planejamento_analises(id) on delete cascade,
  acao text not null, usuario_id uuid references auth.users(id), dados_json jsonb, criado_em timestamptz not null default now()
);
create index if not exists ix_planejamento_analises_status on public.planejamento_analises(status,atualizado_em desc);
create index if not exists ix_planejamento_empresas_empresa on public.planejamento_analise_empresas(empresa_id,analise_id);
create index if not exists ix_planejamento_resultados_analise on public.planejamento_resultados(analise_id,snapshot_id);
alter table public.planejamento_analises enable row level security;
alter table public.planejamento_analise_empresas enable row level security;
alter table public.planejamento_snapshots enable row level security;
alter table public.planejamento_premissas enable row level security;
alter table public.planejamento_resultados enable row level security;
alter table public.planejamento_eventos enable row level security;
-- O backend usa service role e aplica o RBAC existente; não há acesso direto do cliente.

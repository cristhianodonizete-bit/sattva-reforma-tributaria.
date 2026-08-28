-- Módulo de Acompanhamento: baseline imutável, fotografia realizada e desvios.
-- Não contém regra tributária; armazena exclusivamente fotografias e memória.
create table if not exists public.monitoring_baselines (
  id bigint primary key, empresa_id bigint not null references public.empresas(id) on delete cascade,
  versao integer not null, data_aprovacao text not null, origem text not null, descricao text,
  cenario_referencia text, premissas_aprovadas jsonb, indicadores_aprovados jsonb not null,
  composicao_fornecedores jsonb, composicao_clientes jsonb, classificacoes_esperadas jsonb,
  recomendacoes_aprovadas jsonb, natureza text not null default 'CALCULADO', memoria jsonb,
  criado_em text, unique(empresa_id,versao)
);
create table if not exists public.monitoring_snapshots (
  id bigint primary key, empresa_id bigint not null references public.empresas(id) on delete cascade,
  periodo text not null, origem text not null, natureza text not null default 'REAL',
  indicadores_realizados jsonb not null, composicao_fornecedores jsonb, composicao_clientes jsonb,
  classificacoes_reais jsonb, cobertura_dados jsonb, memoria jsonb, criado_em text,
  unique(empresa_id,periodo,origem)
);
create table if not exists public.monitoring_comparisons (
  id bigint primary key, empresa_id bigint not null references public.empresas(id) on delete cascade,
  baseline_id bigint not null references public.monitoring_baselines(id) on delete restrict,
  snapshot_id bigint not null references public.monitoring_snapshots(id) on delete cascade,
  status text not null, memoria jsonb, criado_em text, unique(baseline_id,snapshot_id)
);
create table if not exists public.monitoring_deviations (
  id bigint primary key, comparison_id bigint not null references public.monitoring_comparisons(id) on delete cascade,
  metrica text not null, tipo text not null, baseline_valor numeric, realizado_valor numeric,
  diferenca_absoluta numeric, diferenca_percentual numeric, status text not null, causa text,
  evidencia text, acao_sugerida text, natureza text not null default 'CALCULADO', memoria jsonb, criado_em text
);
create index if not exists ix_monitoring_baselines_empresa on public.monitoring_baselines(empresa_id,versao desc);
create index if not exists ix_monitoring_snapshots_empresa on public.monitoring_snapshots(empresa_id,periodo desc);
create index if not exists ix_monitoring_deviations_comparison on public.monitoring_deviations(comparison_id,tipo);

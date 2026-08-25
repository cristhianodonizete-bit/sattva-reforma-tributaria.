-- Formação de custo: dados operacionais, separados de motor_resultados.
-- Execute no Supabase SQL Editor antes de ativar a tela em produção.
create table if not exists public.formacao_custo_itens (
  id bigint primary key,
  empresa_id bigint not null,
  codigo text,
  descricao text not null,
  tipo text default 'mercadoria',
  sku text,
  gtin text,
  ncm text,
  nbs text,
  unidade text,
  centro_custo text,
  ativo boolean default true,
  status_formacao_custo text default 'INCOMPLETO',
  origem text default 'MANUAL',
  criado_em timestamptz,
  atualizado_em timestamptz
);

create table if not exists public.formacao_custo_componentes (
  id bigint primary key,
  item_formacao_id bigint not null,
  movimento_id bigint,
  codigo_origem text,
  descricao_origem text,
  relacionamento text not null default 'NAO_RELACIONADA',
  criterio_rateio text,
  percentual_rateio numeric,
  quantidade numeric,
  unidade text,
  status_alocacao_credito text default 'NAO_ALOCADO',
  observacoes text,
  criado_em timestamptz,
  atualizado_em timestamptz
);

create index if not exists ix_formacao_custo_itens_empresa on public.formacao_custo_itens(empresa_id);
create index if not exists ix_formacao_custo_componentes_item on public.formacao_custo_componentes(item_formacao_id);

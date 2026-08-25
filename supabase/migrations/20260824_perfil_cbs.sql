-- Perfil CBS: consolidação materializada, sem motor tributário paralelo.
create table if not exists public.perfil_cbs_competencias (
  id bigint primary key,
  empresa_id bigint not null,
  competencia text not null,
  receita_bruta numeric default 0, compras_brutas numeric default 0,
  base_economica_saidas numeric default 0, base_economica_entradas numeric default 0,
  cbs_debito numeric default 0, cbs_credito numeric default 0, cbs_liquida numeric default 0,
  aliquota_efetiva_cbs_saida numeric, taxa_recuperacao_cbs_entrada numeric,
  receita_tributacao_integral numeric default 0, receita_reducao_cbs numeric default 0,
  receita_aliquota_zero_cbs numeric default 0, receita_imunidade_cbs numeric default 0,
  receita_regime_especifico_cbs numeric default 0, receita_beneficio_governo_cbs numeric default 0,
  receita_tratamento_indeterminado_cbs numeric default 0,
  compras_credito_normal numeric default 0, compras_credito_limitado numeric default 0,
  compras_credito_simples numeric default 0, compras_credito_presumido numeric default 0,
  compras_sem_credito numeric default 0, compras_credito_indeterminado numeric default 0,
  cobertura_classificacao_cbs numeric, cobertura_base_economica numeric, cobertura_credito_cbs numeric,
  percentual_real numeric, percentual_calculado numeric, percentual_simulado numeric, percentual_indeterminado numeric,
  quantidade_documentos integer default 0, quantidade_operacoes integer default 0,
  motor_execucao_id bigint, atualizado_em timestamptz default now(),
  unique (empresa_id, competencia)
);
create index if not exists ix_perfil_cbs_empresa_competencia on public.perfil_cbs_competencias(empresa_id, competencia);
alter table public.perfil_cbs_competencias enable row level security;

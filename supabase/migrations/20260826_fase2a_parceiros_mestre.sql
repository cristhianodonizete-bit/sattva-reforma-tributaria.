-- Complemento da Fase 2A: cadastro mestre compartilhado de parceiros.
-- É aditivo e não substitui o cache técnico/local de consultas de CNPJ.
create table if not exists public.cadastro_parceiros_mestre (
  cnpj text primary key, razao_social text, tipo text, regime_atual text, regime_cbs text,
  simples boolean, mei boolean, governo boolean, esfera text, produtor_rural boolean,
  cooperativa boolean, perfil_credito text, vigencia_inicio text, vigencia_fim text,
  origem text, evidencia text, status text default 'ATIVO', versao integer default 1,
  atualizado_em timestamptz
);
create index if not exists ix_cadastro_parceiros_regime on public.cadastro_parceiros_mestre(regime_atual, regime_cbs);
alter table public.cadastro_parceiros_mestre enable row level security;
-- O servidor usa service key; não há política pública.

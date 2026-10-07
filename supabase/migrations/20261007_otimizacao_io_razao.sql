-- Índices para as leituras do Razão. Este arquivo documenta a manutenção;
-- em produção deve ser executado pelo aplicador concorrente, pois PostgreSQL
-- não permite CREATE INDEX CONCURRENTLY dentro de uma transação.
create extension if not exists pg_trgm;

create index concurrently if not exists ix_questor_pessoas_nome_trgm
  on public.questor_pessoas using gin (nome gin_trgm_ops)
  where inscr_federal is not null;

create index concurrently if not exists ix_movimentos_empresa_origem_nome
  on public.movimentos (empresa_id, origem, nome)
  where origem = 'QUESTOR_RAZAO';

create index concurrently if not exists ix_parceiros_empresa_tipo_cnpj
  on public.parceiros (empresa_id, tipo, cnpj);

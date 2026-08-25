-- Central de exceções persistida para operação por exceção em toda a carteira.
-- Execute com RLS habilitado; o backend usa a chave secreta do servidor.
create table if not exists public.excecoes_motor (
  id bigint primary key,
  empresa_id bigint not null,
  movimento_id bigint,
  execucao_id bigint,
  codigo text not null,
  categoria text not null,
  gravidade text default 'media',
  status text default 'ABERTA',
  natureza text default 'INDETERMINADO',
  origem text default 'MOTOR',
  valor_envolvido numeric default 0,
  impacto_cbs_estimado numeric,
  materialidade numeric default 0,
  detalhe text,
  criado_em timestamptz,
  atualizado_em timestamptz,
  resolvido_em timestamptz,
  unique (empresa_id, movimento_id, codigo)
);

create index if not exists ix_excecoes_motor_empresa_status
  on public.excecoes_motor (empresa_id, status, materialidade desc);

alter table public.excecoes_motor enable row level security;

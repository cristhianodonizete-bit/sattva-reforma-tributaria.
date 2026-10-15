-- Evidências de regime com vigência; não substitui o cadastro atual.
create table if not exists public.historico_regimes_cnpj (
  id bigserial primary key, cnpj text not null check (cnpj ~ '^[0-9]{14}$'), raiz text not null check (raiz ~ '^[0-9]{8}$'),
  regime text not null, versao integer not null default 1, vigencia_inicio date not null, vigencia_fim date,
  fonte text not null, justificativa text, registrado_em timestamptz not null default now(),
  unique(cnpj, vigencia_inicio), check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create index if not exists ix_historico_regimes_cnpj_raiz_vigencia on public.historico_regimes_cnpj(raiz,vigencia_inicio,vigencia_fim);
alter table public.historico_regimes_cnpj enable row level security;

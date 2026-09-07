-- Camada aditiva de referência oficial e matriz fiscal versionada.
-- Não atualiza base_ncm/base_servicos, não altera motor e não publica regras.
create table if not exists public.referencias_fiscais_oficiais (
  id bigint generated always as identity primary key,
  dominio text not null check (dominio in ('NCM','NBS','LC116')),
  codigo text not null,
  descricao text not null default '',
  vigencia_inicio date,
  vigencia_fim date,
  situacao text not null default 'VIGENTE' check (situacao in ('VIGENTE','EXTINTO','FUTURO','HISTORICO')),
  fonte text not null,
  versao_fonte text not null default '',
  hash_origem text not null default '',
  dados_origem jsonb not null default '{}'::jsonb,
  importado_em timestamptz not null default now(),
  unique(dominio,codigo,vigencia_inicio,fonte,versao_fonte)
);
create index if not exists ix_referencias_fiscais_oficiais_codigo on public.referencias_fiscais_oficiais(dominio,codigo,situacao,vigencia_inicio desc);

create table if not exists public.referencias_fiscais_relacoes (
  id bigint generated always as identity primary key,
  origem_id bigint not null references public.referencias_fiscais_oficiais(id) on delete restrict,
  destino_id bigint not null references public.referencias_fiscais_oficiais(id) on delete restrict,
  tipo text not null check (tipo in ('NBS_LC116')),
  vigencia_inicio date,
  vigencia_fim date,
  fonte text not null,
  evidencia text,
  importado_em timestamptz not null default now(),
  unique(origem_id,destino_id,tipo,vigencia_inicio,fonte)
);
create index if not exists ix_referencias_fiscais_relacoes_origem on public.referencias_fiscais_relacoes(origem_id,tipo,vigencia_inicio desc);
create index if not exists ix_referencias_fiscais_relacoes_destino on public.referencias_fiscais_relacoes(destino_id,tipo,vigencia_inicio desc);

create table if not exists public.matriz_regras_fiscais_versionada (
  id text primary key,
  tributo text not null check (tributo in ('PIS_COFINS','CBS')),
  tipo_chave text not null check (tipo_chave in ('NCM','NBS_LC116','REGIME')),
  ncm text, nbs text, lc116 text,
  vigencia_inicio date not null,
  vigencia_fim date,
  prioridade integer not null default 0,
  condicoes_json jsonb not null default '[]'::jsonb,
  resultado_json jsonb not null default '{}'::jsonb,
  fundamento text not null default '',
  fonte text not null,
  versao_fonte text not null default '',
  status text not null default 'RASCUNHO' check(status in ('RASCUNHO','VALIDADA','APROVADA','REJEITADA','PUBLICADA')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check ((tipo_chave='NCM' and ncm is not null and nbs is null and lc116 is null)
    or (tipo_chave='NBS_LC116' and ncm is null and nbs is not null and lc116 is not null)
    or (tipo_chave='REGIME' and ncm is null and nbs is null and lc116 is null))
);
create index if not exists ix_matriz_regras_fiscais_versionada_resolucao on public.matriz_regras_fiscais_versionada(tributo,tipo_chave,ncm,nbs,lc116,status,vigencia_inicio desc,prioridade desc);

alter table public.referencias_fiscais_oficiais enable row level security;
alter table public.referencias_fiscais_relacoes enable row level security;
alter table public.matriz_regras_fiscais_versionada enable row level security;
create policy "referencias_fiscais_leitura_autenticada" on public.referencias_fiscais_oficiais for select to authenticated using (true);
create policy "referencias_fiscais_relacoes_leitura_autenticada" on public.referencias_fiscais_relacoes for select to authenticated using (true);
create policy "matriz_regras_fiscais_leitura_autenticada" on public.matriz_regras_fiscais_versionada for select to authenticated using (true);

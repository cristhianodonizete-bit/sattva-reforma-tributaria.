-- Camada histórica aditiva: não altera base_ncm, movimentos nem motor.
create table if not exists public.referencias_fiscais_correlacoes_historicas (
  id bigint generated always as identity primary key,
  dominio text not null check (dominio='NCM'),
  codigo_origem text not null,
  codigo_destino text not null,
  tipo_relacao text not null check (tipo_relacao in ('DIRETA','PARCIAL_EX')),
  versao_origem text not null,
  versao_destino text not null,
  vigencia_inicio date,
  fonte text not null,
  hash_origem text not null,
  evidencia text not null default '',
  importado_em timestamptz not null default now(),
  unique(dominio,codigo_origem,codigo_destino,tipo_relacao,versao_origem,versao_destino,fonte,hash_origem)
);
create index if not exists ix_referencias_fiscais_correlacoes_historicas_origem on public.referencias_fiscais_correlacoes_historicas(dominio,codigo_origem,tipo_relacao);
create index if not exists ix_referencias_fiscais_correlacoes_historicas_destino on public.referencias_fiscais_correlacoes_historicas(dominio,codigo_destino);
alter table public.referencias_fiscais_correlacoes_historicas enable row level security;
create policy "correlacoes_historicas_ncm_leitura_autenticada" on public.referencias_fiscais_correlacoes_historicas for select to authenticated using (true);

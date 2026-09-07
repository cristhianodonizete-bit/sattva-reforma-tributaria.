-- Carga operacional incremental PIS/Cofins + CBS.
-- É aditiva: não remove base_ncm, base_servicos, movimentos ou resultados.
create table if not exists public.catalogo_regras_operacionais_importadas (
  chave_regra text primary key,
  tipo_chave text not null check (tipo_chave in ('NCM','NBS_LC116','PIS_CONDICIONAL')),
  base_ncm_id bigint references public.base_ncm(id) on delete restrict,
  base_servico_id bigint references public.base_servicos(id) on delete restrict,
  regra_enquadramento_id text references public.regras_enquadramento(id) on delete restrict,
  hash_conteudo char(64) not null,
  fonte text not null,
  fundamento text not null,
  vigencia_inicio date not null,
  vigencia_fim date,
  atualizado_em timestamptz not null default now(),
  check ((tipo_chave='NCM' and base_ncm_id is not null and base_servico_id is null and regra_enquadramento_id is null)
    or (tipo_chave='NBS_LC116' and base_ncm_id is null and base_servico_id is not null and regra_enquadramento_id is null)
    or (tipo_chave='PIS_CONDICIONAL' and base_ncm_id is null and base_servico_id is null and regra_enquadramento_id is not null))
);
create index if not exists ix_catalogo_regras_operacionais_ncm on public.catalogo_regras_operacionais_importadas(base_ncm_id);
create index if not exists ix_catalogo_regras_operacionais_servico on public.catalogo_regras_operacionais_importadas(base_servico_id);
alter table public.catalogo_regras_operacionais_importadas enable row level security;
create policy "catalogo_regras_operacionais_leitura_autenticada" on public.catalogo_regras_operacionais_importadas for select to authenticated using (true);

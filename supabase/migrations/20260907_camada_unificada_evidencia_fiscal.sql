alter table public.enriquecimento_pis_cofins_evidencias
  add column if not exists tipo_fonte text,
  add column if not exists lote_origem_id bigint references public.lotes(id),
  add column if not exists hash_lineage text,
  add column if not exists numero_documento text,
  add column if not exists serie text,
  add column if not exists base_pis numeric,
  add column if not exists base_cofins numeric,
  add column if not exists aliquota_pis numeric,
  add column if not exists aliquota_cofins numeric,
  add column if not exists natureza_credito text,
  add column if not exists condicao_credito text,
  add column if not exists grau_confianca text;

create index if not exists ix_evidencia_pis_cofins_lote on public.enriquecimento_pis_cofins_evidencias(empresa_id,lote_origem_id);

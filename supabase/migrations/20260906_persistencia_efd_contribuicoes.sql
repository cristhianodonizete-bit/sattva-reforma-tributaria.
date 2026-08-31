alter table public.lotes
  add column if not exists tipo_arquivo text,
  add column if not exists hash_sha256 text,
  add column if not exists competencia_inicio text,
  add column if not exists competencia_fim text,
  add column if not exists cnpj_arquivo text,
  add column if not exists status_importacao text;

create unique index if not exists ux_lotes_efd_empresa_tipo_hash
  on public.lotes(empresa_id, tipo_arquivo, hash_sha256)
  where tipo_arquivo = 'EFD_CONTRIBUICOES' and hash_sha256 is not null;

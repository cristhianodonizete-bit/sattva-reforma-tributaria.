-- O id SQLite é técnico e pode reiniciar em outra instância. A identidade
-- fiscal compartilhada de um item XML é a chave eletrônica da nota + item.
-- Chave vazia significa "não identificada" e deve ser NULL para não criar
-- colisões artificiais na restrição composta.
update public.movimentos set chave = null where chave is not null and btrim(chave) = '';

-- A fonte compartilhada passa a gerar seu próprio id técnico. O id local não
-- é transportado para XMLs porque ele não é estável entre instâncias.
create sequence if not exists public.movimentos_id_compartilhado_seq;
select setval('public.movimentos_id_compartilhado_seq', coalesce((select max(id) from public.movimentos), 0) + 1, false);
alter table public.movimentos alter column id set default nextval('public.movimentos_id_compartilhado_seq');

create unique index if not exists ux_movimentos_empresa_chave_item
  on public.movimentos (empresa_id, chave, item_numero);

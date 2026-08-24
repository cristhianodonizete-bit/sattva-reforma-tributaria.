-- Uma linha por item da fonte: o mesmo NCM pode possuir descrições ou
-- condições distintas e não pode ser condensado pela chave fiscal.
alter table public.regras_governo add column if not exists origem_linha text;
alter table public.regras_governo drop constraint if exists regras_governo_tipo_chave_cclasstrib_key;
create unique index if not exists regras_governo_fonte_origem_linha_key
  on public.regras_governo (fonte, origem_linha);

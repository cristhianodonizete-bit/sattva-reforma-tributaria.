-- CNAE principal permanece em empresas.cnae. As atividades secundárias são
-- uma lista de evidências da consulta cadastral, sem qualquer efeito sobre
-- QSA, enquadramento, regime ou cálculo tributário.
alter table public.empresas
  add column if not exists cnaes_secundarios text;

alter table public.cadastros_cnpj
  add column if not exists cnaes_secundarios text;

-- Endereço retornado pela consulta cadastral: uma única fotografia por CNPJ,
-- compartilhada pela carteira. Não substitui endereço informado manualmente
-- no cadastro da empresa nem altera documentos fiscais já importados.
alter table public.cadastros_cnpj
  add column if not exists logradouro text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists cep text;

-- Um CNPJ é cadastrado uma única vez. Em parceiros ficam somente os vínculos
-- por empresa: cliente, fornecedor ou ambos.
create table if not exists public.cadastros_cnpj (
  cnpj text primary key,
  razao_social text, situacao text, porte text,
  cnae text, cnae_descricao text, uf text, municipio text,
  optante_simples boolean default false,
  data_opcao_simples text, data_exclusao_simples text,
  optante_mei boolean default false,
  data_opcao_mei text, data_exclusao_mei text,
  regime_derivado text, justificativa text,
  natureza_juridica text, codigo_natureza_juridica text, efr text,
  fonte text, consultado_em timestamptz
);

alter table public.cadastros_cnpj enable row level security;

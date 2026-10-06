-- Cadastro mestre do Questor para vincular a conta de contrapartida do Razão
-- ao CNPJ/CPF e, daí, ao fornecedor e respectivo regime.
create table if not exists public.questor_pessoas (
  codigo_pessoa text primary key,
  nome text not null default '',
  inscr_federal text,
  atualizado_em timestamptz not null default now()
);

create index if not exists ix_questor_pessoas_inscr_federal
  on public.questor_pessoas(inscr_federal);

alter table public.questor_pessoas enable row level security;

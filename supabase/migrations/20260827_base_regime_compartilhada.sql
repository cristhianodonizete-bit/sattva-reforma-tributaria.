-- Base anual RFB compartilhada entre todas as instâncias do sistema.
-- O servidor utiliza a service role para o cruzamento interno; RLS evita a
-- exposição direta da relação de CNPJs ao navegador.
create table if not exists public.base_regime (
  cnpj text not null,
  raiz text not null,
  regime text not null,
  ano integer not null,
  fonte text,
  primary key (cnpj, ano)
);

create index if not exists ix_base_regime_raiz on public.base_regime (raiz, ano);
alter table public.base_regime enable row level security;

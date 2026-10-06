-- A prévia do Razão não é um arquivo transitório: ela guarda a conciliação
-- já revisada pelo usuário e precisa sobreviver a reinícios do Web Service.
create table if not exists public.questor_razao_previas (
  empresa_id bigint primary key references public.empresas(id) on delete cascade,
  arquivo text not null default '',
  resultado_json text not null default '{}',
  atualizado_em timestamptz not null default now()
);

create index if not exists ix_questor_razao_previas_atualizado
  on public.questor_razao_previas(atualizado_em desc);

alter table public.questor_razao_previas enable row level security;

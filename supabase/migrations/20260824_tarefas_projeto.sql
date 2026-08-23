create table if not exists public.projeto_responsaveis (
  id uuid primary key default gen_random_uuid(), projeto_id uuid not null references public.projetos(id) on delete cascade,
  entrega_id uuid references public.projeto_entregas(id) on delete cascade, origem_local_id bigint unique,
  lado text not null check (lado in ('sattva','cliente')), nome text not null, telefone text, email text, funcao text, criado_em timestamptz default now()
);
create table if not exists public.projeto_tarefas (
  id uuid primary key default gen_random_uuid(), projeto_id uuid not null references public.projetos(id) on delete cascade,
  entrega_id uuid not null references public.projeto_entregas(id) on delete cascade, origem_local_id bigint unique,
  titulo text not null, descricao text, status text not null default 'aberta', data_abertura date, data_conclusao date,
  envolve_cliente boolean not null default false, pendencia_cliente text, interacoes_cliente text, criado_em timestamptz default now(), atualizado_em timestamptz
);
alter table public.projeto_responsaveis enable row level security;
alter table public.projeto_tarefas enable row level security;

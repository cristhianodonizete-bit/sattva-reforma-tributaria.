create table if not exists public.grupos_empresas (
  id uuid primary key default gen_random_uuid(), nome text not null, descricao text, criado_por uuid references auth.users(id), criado_em timestamptz not null default now()
);
create table if not exists public.grupos_empresas_itens (
  grupo_id uuid not null references public.grupos_empresas(id) on delete cascade,
  empresa_id bigint not null, primary key (grupo_id, empresa_id)
);
alter table public.grupos_empresas enable row level security;
alter table public.grupos_empresas_itens enable row level security;
create policy "grupos visiveis a usuarios autenticados" on public.grupos_empresas for select using (auth.uid() is not null);
create policy "itens de grupos visiveis a usuarios autenticados" on public.grupos_empresas_itens for select using (auth.uid() is not null);

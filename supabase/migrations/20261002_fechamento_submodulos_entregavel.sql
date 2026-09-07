-- Substitui o controle amplo por fechamento individual de cada submódulo.
-- As tabelas 20261001 são preservadas para auditoria e não são convertidas
-- silenciosamente: um fechamento amplo não prova revisão de cada entrega.
create table if not exists public.empresa_submodulos_entrega (
  empresa_id bigint not null references public.empresas(id) on delete cascade,
  submodulo text not null,
  status text not null default 'ABERTO' check (status in ('ABERTO','FECHADO')),
  fechado_em timestamptz, fechado_por uuid references auth.users(id), observacao text,
  reaberto_em timestamptz, reaberto_por uuid references auth.users(id), motivo_reabertura text,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id,submodulo)
);
create table if not exists public.empresa_submodulos_entrega_eventos (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references public.empresas(id) on delete cascade,
  submodulo text not null, acao text not null check (acao in ('FECHADO','REABERTO')),
  usuario_id uuid references auth.users(id), dados_json jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists ix_empresa_submodulos_entrega_status on public.empresa_submodulos_entrega(empresa_id,status);
create index if not exists ix_empresa_submodulos_entrega_eventos on public.empresa_submodulos_entrega_eventos(empresa_id,submodulo,id desc);
alter table public.empresa_submodulos_entrega enable row level security;
alter table public.empresa_submodulos_entrega_eventos enable row level security;
create policy "fechamento submodulo empresa visivel" on public.empresa_submodulos_entrega for select using (public.tem_acesso_empresa(empresa_id));
create policy "eventos fechamento submodulo visiveis" on public.empresa_submodulos_entrega_eventos for select using (public.tem_acesso_empresa(empresa_id));

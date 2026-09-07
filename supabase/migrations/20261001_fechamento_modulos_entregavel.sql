-- Fechamento auditável dos módulos por empresa. Não altera resultados fiscais,
-- cenários ou entregas existentes; somente controla a prontidão do entregável.
create table if not exists public.empresa_modulos_entrega (
  empresa_id bigint not null references public.empresas(id) on delete cascade,
  modulo text not null check (modulo in ('diagnostico','precificacao','contratos','capacitacao','planejamento','acompanhamento')),
  status text not null default 'ABERTO' check (status in ('ABERTO','FECHADO')),
  fechado_em timestamptz,
  fechado_por uuid references auth.users(id),
  observacao text,
  reaberto_em timestamptz,
  reaberto_por uuid references auth.users(id),
  motivo_reabertura text,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, modulo)
);
create table if not exists public.empresa_modulos_entrega_eventos (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references public.empresas(id) on delete cascade,
  modulo text not null,
  acao text not null check (acao in ('FECHADO','REABERTO')),
  usuario_id uuid references auth.users(id),
  dados_json jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists ix_empresa_modulos_entrega_status on public.empresa_modulos_entrega(empresa_id,status);
create index if not exists ix_empresa_modulos_entrega_eventos on public.empresa_modulos_entrega_eventos(empresa_id,modulo,id desc);
alter table public.empresa_modulos_entrega enable row level security;
alter table public.empresa_modulos_entrega_eventos enable row level security;
-- Escritas passam pelo backend com service role e auditoria da aplicação.
create policy "fechamento modulo empresa visivel" on public.empresa_modulos_entrega for select using (public.tem_acesso_empresa(empresa_id));
create policy "eventos fechamento modulo visiveis" on public.empresa_modulos_entrega_eventos for select using (public.tem_acesso_empresa(empresa_id));

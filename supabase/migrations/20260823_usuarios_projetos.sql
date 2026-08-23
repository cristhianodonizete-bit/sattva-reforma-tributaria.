-- Sattva Reforma Tributária | Camada multiusuário
-- Execute no SQL Editor do projeto Supabase antes de ativar o modo compartilhado.
-- Esta migração não remove nem altera os dados do banco SQLite local.

create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  papel text not null default 'consultor' check (papel in ('administrador', 'gestor', 'consultor', 'visualizacao')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.empresas_usuarios (
  empresa_id bigint not null,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'consultor' check (papel in ('gestor', 'consultor', 'visualizacao')),
  atribuido_em timestamptz not null default now(),
  primary key (empresa_id, usuario_id)
);

-- Cada processo pertence a uma empresa, mas pode ter vários responsáveis.
create table if not exists public.processos_projeto (
  id uuid primary key default gen_random_uuid(),
  empresa_id bigint not null,
  contratacao_id bigint,
  titulo text not null,
  tipo text not null default 'entrega',
  status text not null default 'pendente' check (status in ('pendente', 'em_andamento', 'concluido', 'cancelado')),
  prazo date,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.processos_responsaveis (
  processo_id uuid not null references public.processos_projeto(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'responsavel' check (papel in ('responsavel', 'participante', 'aprovador')),
  primary key (processo_id, usuario_id)
);

create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  empresa_id bigint,
  usuario_id uuid references auth.users(id),
  acao text not null,
  entidade text not null,
  entidade_id text,
  antes jsonb,
  depois jsonb,
  criado_em timestamptz not null default now()
);

alter table public.perfis enable row level security;
alter table public.empresas_usuarios enable row level security;
alter table public.processos_projeto enable row level security;
alter table public.processos_responsaveis enable row level security;
alter table public.auditoria enable row level security;

create or replace function public.eh_admin_ou_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel in ('administrador', 'gestor'));
$$;

create or replace function public.tem_acesso_empresa(alvo_empresa bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_admin_ou_gestor() or exists (
    select 1 from public.empresas_usuarios where empresa_id = alvo_empresa and usuario_id = auth.uid()
  );
$$;

create policy "perfil proprio ou gestor" on public.perfis for select using (id = auth.uid() or public.eh_admin_ou_gestor());
create policy "empresa atribuida" on public.empresas_usuarios for select using (usuario_id = auth.uid() or public.eh_admin_ou_gestor());
create policy "processo da empresa atribuida" on public.processos_projeto for select using (public.tem_acesso_empresa(empresa_id));
create policy "responsaveis do processo visiveis" on public.processos_responsaveis for select using (
  exists (select 1 from public.processos_projeto p where p.id = processo_id and public.tem_acesso_empresa(p.empresa_id))
);
create policy "auditoria da empresa atribuida" on public.auditoria for select using (public.tem_acesso_empresa(empresa_id));


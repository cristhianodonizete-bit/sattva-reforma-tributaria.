-- Sattva | Capacitação compartilhada
-- Mantém os IDs locais para que o cache do Render possa ser reconstruído
-- integralmente a partir do Supabase, sem perder vínculos existentes.

create table if not exists public.turmas (
  id bigint primary key,
  empresa_id bigint not null references public.empresas(id) on delete cascade,
  trilha text,
  titulo text,
  formato text default 'presencial',
  data text,
  carga_horaria numeric default 4,
  instrutor text,
  limite_participantes integer not null default 30 check (limite_participantes > 0),
  status text default 'planejada',
  observacoes text
);

create table if not exists public.participantes (
  id bigint primary key,
  turma_id bigint not null references public.turmas(id) on delete cascade,
  empresa_id bigint references public.empresas(id) on delete set null,
  nome text not null,
  area text,
  email text,
  presenca boolean not null default false,
  nota_avaliacao numeric
);

alter table public.turmas add column if not exists limite_participantes integer not null default 30;
alter table public.participantes add column if not exists empresa_id bigint references public.empresas(id) on delete set null;
create index if not exists ix_turmas_empresa on public.turmas(empresa_id);
create index if not exists ix_participantes_turma on public.participantes(turma_id);
create index if not exists ix_participantes_empresa on public.participantes(empresa_id);

alter table public.turmas enable row level security;
alter table public.participantes enable row level security;

drop policy if exists "turmas da empresa atribuida" on public.turmas;
create policy "turmas da empresa atribuida" on public.turmas for select using (public.tem_acesso_empresa(empresa_id));
drop policy if exists "participantes da turma atribuida" on public.participantes;
create policy "participantes da turma atribuida" on public.participantes for select using (
  exists (select 1 from public.turmas t where t.id = turma_id and public.tem_acesso_empresa(t.empresa_id))
);

-- Especialista Fiscal Sênior: chave operacional e histórico auditável.
-- Não concede ao modelo permissão para modificar motor, catálogo ou regras.
alter table public.ia_config add column if not exists especialista_fiscal_ativo boolean not null default false;

create table if not exists public.especialista_fiscal_interacoes (
  id bigint generated always as identity primary key,
  empresa_id bigint references public.empresas(id) on delete set null,
  usuario_id uuid references auth.users(id),
  pergunta text not null,
  resposta text not null,
  modelo text,
  fontes_json jsonb not null default '[]'::jsonb,
  uso_json jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists ix_especialista_fiscal_interacoes_empresa on public.especialista_fiscal_interacoes(empresa_id,id desc);
alter table public.especialista_fiscal_interacoes enable row level security;
-- Backend via service role; o RBAC da aplicação controla a carteira autorizada.

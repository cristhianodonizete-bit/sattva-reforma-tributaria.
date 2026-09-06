-- Assistente Tributário: trilha auditável de explicações geradas por IA.
-- Não grava cálculos, regras, documentos ou cadastro da empresa.
create table if not exists public.planejamento_assistente_interacoes (
  id bigint generated always as identity primary key,
  analise_id bigint not null references public.planejamento_analises(id) on delete cascade,
  snapshot_id bigint not null references public.planejamento_snapshots(id) on delete restrict,
  usuario_id uuid references auth.users(id),
  pergunta text not null,
  resposta text not null,
  modelo text,
  uso_json jsonb,
  contexto_json jsonb not null,
  criado_em timestamptz not null default now()
);
create index if not exists ix_planejamento_assistente_analise on public.planejamento_assistente_interacoes(analise_id,id desc);
alter table public.planejamento_assistente_interacoes enable row level security;
-- Backend via service role; o RBAC da aplicação valida as empresas da análise.

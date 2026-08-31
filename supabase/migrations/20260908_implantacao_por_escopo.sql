-- Fase 4A: checklist operacional derivado do escopo já contratado.
-- A tabela não altera entregas, tarefas, documentos ou módulos existentes.
create table if not exists public.projeto_checklist_implantacao (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  entrega_id uuid references public.projeto_entregas(id) on delete set null,
  origem_local_id bigint unique,
  escopo text not null check (escopo in ('diagnostico','contratos','precificacao','capacitacao','acompanhamento')),
  chave text not null,
  titulo text not null,
  tipo_evidencia text,
  status text not null default 'NAO_SOLICITADO' check (status in ('NAO_SOLICITADO','SOLICITADO','AGUARDANDO_CLIENTE','RECEBIDO','PARCIAL','COM_PENDENCIA','VALIDADO','CONCLUIDO','NAO_APLICAVEL')),
  responsavel_id uuid references public.projeto_responsaveis(id) on delete set null,
  origem_tipo text,
  origem_id text,
  observacoes text,
  ordem integer not null default 0,
  origem text not null default 'AUTOMATICO',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (projeto_id, chave)
);
create index if not exists ix_projeto_checklist_implantacao_projeto on public.projeto_checklist_implantacao(projeto_id, escopo, ordem);
create index if not exists ix_projeto_checklist_implantacao_status on public.projeto_checklist_implantacao(status);
alter table public.projeto_checklist_implantacao enable row level security;
create policy "checklist do projeto da empresa atribuida" on public.projeto_checklist_implantacao for select using (
  exists (select 1 from public.projetos p where p.id = projeto_id and public.tem_acesso_empresa(p.empresa_id))
);

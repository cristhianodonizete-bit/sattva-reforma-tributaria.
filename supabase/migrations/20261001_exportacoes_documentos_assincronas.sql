-- Fila técnica de exportações: não é fonte fiscal e não participa do motor.
-- O arquivo é privado e efêmero; a aplicação remove o objeto após 24 horas.
create table if not exists public.exportacoes_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id bigint not null references public.empresas(id) on delete restrict,
  filtros jsonb not null default '{}'::jsonb,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','PROCESSANDO','CONCLUIDO','FALHOU','EXPIRADO')),
  arquivo_path text,
  arquivo_nome text,
  total_documentos integer,
  erro text,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  expira_em timestamptz not null default (now() + interval '24 hours')
);
create index if not exists ix_exportacoes_documentos_status on public.exportacoes_documentos(status, criado_em);
create index if not exists ix_exportacoes_documentos_expira on public.exportacoes_documentos(expira_em) where status='CONCLUIDO';
alter table public.exportacoes_documentos enable row level security;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('exportacoes-documentos','exportacoes-documentos',false,52428800,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

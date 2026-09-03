-- Responsável interno de uma entrega passa a apontar para o usuário autenticado.
-- Os registros antigos de contato em texto são preservados integralmente.
alter table public.projeto_responsaveis
  add column if not exists usuario_id uuid references public.perfis(id) on delete set null;

create index if not exists ix_projeto_responsaveis_usuario_entrega
  on public.projeto_responsaveis (usuario_id, entrega_id)
  where usuario_id is not null;

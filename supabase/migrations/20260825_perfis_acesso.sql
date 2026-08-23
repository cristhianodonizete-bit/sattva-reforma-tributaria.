-- Controle de acesso configurável por perfil.
-- Executar no SQL Editor do Supabase antes de publicar usuários/perfis pela tela.

create table if not exists public.perfis_acesso (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text not null default '',
  permissoes jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.perfis add column if not exists perfil_acesso_id uuid references public.perfis_acesso(id);

insert into public.perfis_acesso (nome, descricao, permissoes)
values
  ('Administrador', 'Acesso completo à operação e às configurações.',
   '{"visao_geral":{"ver":true},"diagnostico":{"ver":true,"executar":true},"precificacao":{"ver":true,"executar":true},"contratos":{"ver":true,"executar":true},"capacitacao":{"ver":true,"executar":true},"gestao_projetos":{"ver":true,"executar":true},"configuracoes":{"ver":true,"executar":true},"acessos":{"ver":true,"executar":true}}'::jsonb),
  ('Gestor de projetos', 'Acompanha e executa entregas, sem administrar acessos.',
   '{"visao_geral":{"ver":true},"diagnostico":{"ver":true,"executar":true},"precificacao":{"ver":true,"executar":true},"contratos":{"ver":true,"executar":true},"capacitacao":{"ver":true,"executar":true},"gestao_projetos":{"ver":true,"executar":true},"configuracoes":{"ver":true},"acessos":{"ver":false}}'::jsonb),
  ('Consultor', 'Executa análises e tarefas nos projetos atribuídos.',
   '{"visao_geral":{"ver":true},"diagnostico":{"ver":true,"executar":true},"precificacao":{"ver":true,"executar":true},"contratos":{"ver":true,"executar":true},"capacitacao":{"ver":true,"executar":true},"gestao_projetos":{"ver":true,"executar":true},"configuracoes":{"ver":false},"acessos":{"ver":false}}'::jsonb),
  ('Visualização', 'Consulta os projetos e relatórios, sem alterar dados.',
   '{"visao_geral":{"ver":true},"diagnostico":{"ver":true},"precificacao":{"ver":true},"contratos":{"ver":true},"capacitacao":{"ver":true},"gestao_projetos":{"ver":true},"configuracoes":{"ver":false},"acessos":{"ver":false}}'::jsonb)
on conflict (nome) do update set descricao = excluded.descricao, permissoes = excluded.permissoes, atualizado_em = now();

-- Mantém os usuários atuais funcionando com um perfil inicial compatível.
update public.perfis p
set perfil_acesso_id = pa.id
from public.perfis_acesso pa
where p.perfil_acesso_id is null
  and pa.nome = case p.papel
    when 'administrador' then 'Administrador'
    when 'gestor' then 'Gestor de projetos'
    when 'visualizacao' then 'Visualização'
    else 'Consultor'
  end;

alter table public.perfis_acesso enable row level security;

create policy "perfis de acesso visiveis para autenticados"
on public.perfis_acesso for select
to authenticated
using (true);


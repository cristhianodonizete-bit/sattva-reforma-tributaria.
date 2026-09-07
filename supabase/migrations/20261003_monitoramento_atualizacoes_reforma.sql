-- Estado do monitor diário de fontes oficiais. A tabela não publica regras,
-- não altera catálogo e não contém conteúdo jurídico interpretado.
create table if not exists public.monitoramento_atualizacoes_reforma (
  chave text primary key,
  fonte_nome text not null,
  fonte_url text not null,
  ultimo_hash text,
  ultima_consulta_em timestamptz,
  ultimo_sucesso_em timestamptz,
  ultimo_erro text
);

alter table public.monitoramento_atualizacoes_reforma enable row level security;
create policy "monitoramento_atualizacoes_reforma_leitura_autenticada"
on public.monitoramento_atualizacoes_reforma for select to authenticated using (true);

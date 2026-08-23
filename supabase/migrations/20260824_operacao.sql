-- Estrutura operacional (fase 1)
create table if not exists public.parceiros (id bigint primary key, empresa_id bigint not null, tipo text not null, cnpj text, descricao text, regime text, regime_resolvido text, perfil_economico text, sensibilidade_credito text, origem text, criado_em timestamptz);
create table if not exists public.movimentos (id bigint primary key, empresa_id bigint not null, lote_id bigint, tipo text not null, nome text, inscr_federal text, descricao text, ncm text, nbs text, cfop text, competencia text, valor numeric, base_calculo numeric, icms numeric, icms_st numeric, ipi numeric, pis numeric, cofins numeric, iss numeric, regime text, reducao text, cclasstrib text, classificacao_origem text, origem text, criado_em timestamptz);
create table if not exists public.lotes (id bigint primary key, empresa_id bigint not null, tipo text, arquivo text, registros integer, ignorados integer, valor_total numeric, mensagens text, origem text, criado_em timestamptz);
create table if not exists public.parametros_operacionais (tabela text not null, chave text not null, dados jsonb not null, primary key (tabela,chave));
create table if not exists public.cenarios_operacionais (id bigint primary key, empresa_id bigint not null, dados jsonb not null);
create table if not exists public.motor_resultados_operacionais (id bigint primary key, empresa_id bigint not null, movimento_id bigint, dados jsonb not null);
create index if not exists ix_movimentos_empresa on public.movimentos(empresa_id);
create index if not exists ix_movimentos_cnpj on public.movimentos(empresa_id,inscr_federal);

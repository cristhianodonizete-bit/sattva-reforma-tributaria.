-- Etapa 2O — memória de decisão aditiva.
-- Não altera motor, resultados, catálogo operacional, parâmetros ou execução ativa.

create table if not exists public.fundamentos_normativos (
  id bigint generated always as identity primary key,
  chave text not null unique,
  norma text not null,
  dispositivo text not null,
  descricao text,
  fonte_oficial text not null,
  vigencia_inicio date,
  vigencia_fim date,
  status_validacao text not null check (status_validacao in ('CONFIRMADO','CONFIRMADO_COM_CONDICAO','PARCIAL')),
  condicao_aplicabilidade text,
  criado_em timestamptz not null default now()
);

create table if not exists public.regras_versionadas (
  id bigint generated always as identity primary key,
  chave text not null,
  versao text not null,
  nome text not null,
  descricao text not null,
  natureza text not null check (natureza in ('REGRA_GERAL_REGIME','REGRA_ESPECIFICA','METODOLOGIA','NORMALIZACAO','PREMISSA')),
  algoritmo_funcao text,
  algoritmo_hash text,
  origem_tecnica text not null,
  status_fundamento text not null check (status_fundamento in ('CONFIRMADO','PARCIAL','INDETERMINADO')),
  precedencia smallint,
  condicao_aplicabilidade text,
  vigencia_inicio date,
  vigencia_fim date,
  criado_em timestamptz not null default now(),
  unique (chave, versao)
);

create table if not exists public.regras_fundamentos (
  regra_id bigint not null references public.regras_versionadas(id) on delete restrict,
  fundamento_id bigint not null references public.fundamentos_normativos(id) on delete restrict,
  status_validacao text not null check (status_validacao in ('CONFIRMADO','CONFIRMADO_COM_CONDICAO','PARCIAL')),
  condicao_aplicabilidade text,
  primary key (regra_id, fundamento_id)
);

create table if not exists public.evidencias_decisao (
  id bigint generated always as identity primary key,
  chave_evidencia text not null unique,
  empresa_id bigint not null references public.empresas(id) on delete restrict,
  movimento_id bigint not null references public.movimentos(id) on delete restrict,
  tipo_evidencia text not null,
  origem text not null,
  documento text,
  campo_normalizado text,
  valor_utilizado jsonb,
  nivel_evidencia text not null check (nivel_evidencia in ('ORIGINAL','NORMALIZADO','INDETERMINADO')),
  origem_documental_disponivel boolean not null default false,
  observacao text,
  criado_em timestamptz not null default now()
);

create table if not exists public.decisoes_memoria (
  id bigint generated always as identity primary key,
  resultado_id bigint not null references public.motor_resultados_operacionais(id) on delete restrict,
  empresa_id bigint not null references public.empresas(id) on delete restrict,
  movimento_id bigint not null references public.movimentos(id) on delete restrict,
  execucao_id bigint not null references public.motor_execucoes_operacionais(id) on delete restrict,
  tipo_decisao text not null check (tipo_decisao in ('RECONSTRUCAO_PIS_COFINS','CLASSIFICACAO_FISCAL','CREDITO_CBS')),
  natureza text,
  grau_determinacao text,
  nivel_rastreabilidade text not null check (nivel_rastreabilidade in ('COMPLETO','PARCIAL','INDETERMINADO')),
  algoritmo_versao text,
  origem_historica text,
  dados_memoria jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  unique (resultado_id, tipo_decisao)
);

create table if not exists public.decisoes_evidencias (
  decisao_id bigint not null references public.decisoes_memoria(id) on delete restrict,
  evidencia_id bigint not null references public.evidencias_decisao(id) on delete restrict,
  papel text not null,
  primary key (decisao_id, evidencia_id)
);

create table if not exists public.decisoes_regras (
  decisao_id bigint not null references public.decisoes_memoria(id) on delete restrict,
  regra_id bigint not null references public.regras_versionadas(id) on delete restrict,
  papel text not null,
  nivel_rastreabilidade text not null check (nivel_rastreabilidade in ('COMPLETO','PARCIAL','INDETERMINADO')),
  primary key (decisao_id, regra_id)
);

create table if not exists public.decisoes_catalogos (
  decisao_id bigint not null references public.decisoes_memoria(id) on delete restrict,
  catalogo_versao_id bigint not null references public.catalogo_versoes(id) on delete restrict,
  catalogo_linha_id bigint not null references public.catalogo_linhas_versoes(id) on delete restrict,
  tipo_vinculo text not null check (tipo_vinculo in ('RETROVINCULO','RESULTADO_ORIGINAL')),
  confianca text not null check (confianca in ('DETERMINISTICA','PARCIAL')),
  primary key (decisao_id, catalogo_linha_id)
);

create table if not exists public.decisoes_parametros (
  decisao_id bigint not null references public.decisoes_memoria(id) on delete restrict,
  parametro_chave text not null,
  versao_parametro text,
  valor jsonb,
  natureza text not null,
  primary key (decisao_id, parametro_chave)
);

create table if not exists public.decisoes_premissas (
  decisao_id bigint not null references public.decisoes_memoria(id) on delete restrict,
  premissa_chave text not null,
  origem text not null,
  natureza text not null check (natureza in ('SIMULADO','PREMISSA')),
  valor jsonb,
  contexto jsonb,
  primary key (decisao_id, premissa_chave)
);

create index if not exists ix_decisoes_memoria_execucao on public.decisoes_memoria(empresa_id, execucao_id, tipo_decisao);
create index if not exists ix_decisoes_memoria_resultado on public.decisoes_memoria(resultado_id);
create index if not exists ix_evidencias_decisao_movimento on public.evidencias_decisao(empresa_id, movimento_id);
create index if not exists ix_decisoes_catalogos_versao_linha on public.decisoes_catalogos(catalogo_versao_id, catalogo_linha_id);

-- Regras e fundamentos que já possuam memória não podem ser silenciosamente
-- reescritos ou removidos. A evolução deve criar nova versão.
create or replace function public.bloquear_mutacao_memoria_versionada() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'regras_versionadas' and exists (select 1 from public.decisoes_regras where regra_id = old.id) then
    raise exception 'Regra versionada em uso é imutável; crie nova versão';
  end if;
  if tg_table_name = 'fundamentos_normativos' and exists (select 1 from public.regras_fundamentos where fundamento_id = old.id) then
    raise exception 'Fundamento normativo em uso é imutável';
  end if;
  if tg_table_name = 'evidencias_decisao' and exists (select 1 from public.decisoes_evidencias where evidencia_id = old.id) then
    raise exception 'Evidência de decisão em uso é imutável';
  end if;
  return old;
end $$;

drop trigger if exists tg_regras_versionadas_imutaveis on public.regras_versionadas;
create trigger tg_regras_versionadas_imutaveis before update or delete on public.regras_versionadas
for each row execute function public.bloquear_mutacao_memoria_versionada();
drop trigger if exists tg_fundamentos_normativos_imutaveis on public.fundamentos_normativos;
create trigger tg_fundamentos_normativos_imutaveis before update or delete on public.fundamentos_normativos
for each row execute function public.bloquear_mutacao_memoria_versionada();
drop trigger if exists tg_evidencias_decisao_imutaveis on public.evidencias_decisao;
create trigger tg_evidencias_decisao_imutaveis before update or delete on public.evidencias_decisao
for each row execute function public.bloquear_mutacao_memoria_versionada();

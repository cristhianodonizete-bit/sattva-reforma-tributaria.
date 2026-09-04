-- Trilha incremental sem conteúdo fiscal/cadastral: cada evento guarda apenas
-- a tabela, a operação, a chave primária e a empresa relacionada quando houver.
-- Isso permite detectar alterações e exclusões sem replicar PII para o log.
create table if not exists public.sincronizacao_operacional_eventos (
  sequencia bigint generated always as identity primary key,
  tabela text not null,
  operacao text not null check (operacao in ('INSERT', 'UPDATE', 'DELETE')),
  chave jsonb not null,
  empresa_id text,
  ocorrido_em timestamptz not null default clock_timestamp()
);

create index if not exists ix_sync_operacional_eventos_sequencia
  on public.sincronizacao_operacional_eventos(sequencia);
create index if not exists ix_sync_operacional_eventos_tabela_sequencia
  on public.sincronizacao_operacional_eventos(tabela, sequencia);
create index if not exists ix_sync_operacional_eventos_empresa_sequencia
  on public.sincronizacao_operacional_eventos(empresa_id, sequencia)
  where empresa_id is not null;

alter table public.sincronizacao_operacional_eventos enable row level security;
revoke all on public.sincronizacao_operacional_eventos from anon, authenticated;

create or replace function public.registrar_evento_sincronizacao_operacional()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  dados jsonb;
  chave_primaria jsonb;
begin
  dados := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;

  -- Obtém as colunas da chave primária pelo catálogo. Assim o log não precisa
  -- conhecer nem gravar as demais colunas do registro.
  select coalesce(jsonb_object_agg(a.attname, dados -> a.attname), '{}'::jsonb)
    into chave_primaria
    from pg_index i
    join unnest(i.indkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = TG_RELID and i.indisprimary;

  if chave_primaria = '{}'::jsonb then
    raise exception 'Tabela % não possui chave primária; evento incremental recusado.', TG_TABLE_NAME;
  end if;

  insert into public.sincronizacao_operacional_eventos(tabela, operacao, chave, empresa_id)
  values (
    TG_TABLE_NAME,
    TG_OP,
    chave_primaria,
    nullif(dados ->> 'empresa_id', '')
  );
  return coalesce(NEW, OLD);
end;
$$;

-- Cobertura inicial do cache operacional. A instalação é condicional: uma
-- tabela ausente em ambiente mais antigo não impede a migration nem cria uma
-- trilha incompleta silenciosa para uma tabela existente sem chave primária.
do $$
declare
  nome_tabela text;
  tabelas text[] := array[
    'empresas', 'empresa_servicos_fiscais', 'parceiros', 'empresa_qsa',
    'lotes', 'movimentos', 'perfil_tributario', 'folhas_pagamento_competencias',
    'margens_operacionais_premissas', 'receitas_sem_dfe', 'formacao_custo_itens',
    'formacao_custo_componentes', 'excecoes_motor', 'excecoes_motor_execucoes',
    'telemetria_autonomia_execucoes', 'enriquecimento_servicos_evidencias',
    'enriquecimento_pis_cofins_evidencias', 'pendencias_enriquecimento_fiscal',
    'perfil_cbs_competencias', 'pricing_products', 'pricing_services',
    'pricing_components', 'pricing_import_batches', 'pricing_simulacoes',
    'contratos', 'contrato_checklist', 'contrato_documentos',
    'contrato_clausulas_extraidas', 'contrato_riscos_iniciais',
    'contrato_precificacao_vinculos', 'contrato_recomendacoes',
    'contrato_sugestoes_clausulas', 'monitoring_baselines', 'monitoring_snapshots',
    'monitoring_comparisons', 'monitoring_deviations', 'monitoring_alerts',
    'monitoring_actions'
  ];
begin
  foreach nome_tabela in array tabelas loop
    if to_regclass('public.' || nome_tabela) is null then
      continue;
    end if;
    if not exists (
      select 1 from pg_index i
       where i.indrelid = to_regclass('public.' || nome_tabela) and i.indisprimary
    ) then
      raise exception 'Tabela operacional % sem chave primária; migration interrompida para evitar sincronização insegura.', nome_tabela;
    end if;
    execute format('drop trigger if exists trg_sync_operacional_evento on public.%I', nome_tabela);
    execute format(
      'create trigger trg_sync_operacional_evento after insert or update or delete on public.%I for each row execute function public.registrar_evento_sincronizacao_operacional()',
      nome_tabela
    );
  end loop;
end;
$$;

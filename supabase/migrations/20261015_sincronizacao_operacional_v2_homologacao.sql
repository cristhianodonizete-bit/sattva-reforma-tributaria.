-- Sincronização operacional v2 (homologação).
-- Não apaga eventos históricos e não ativa retenção. A fila de consumo passa
-- a ter uma sequência publicada após o commit da alteração-fonte, separada
-- da identidade técnica atribuída pelo trigger dentro da transação de origem.

alter table public.sincronizacao_operacional_eventos
  add column if not exists sequencia_consumo bigint;

create table if not exists public.sincronizacao_operacional_estado (
  chave text primary key,
  corte_sequencia_tecnica bigint not null,
  proxima_sequencia_consumo bigint not null default 1,
  atualizado_em timestamptz not null default clock_timestamp(),
  check (proxima_sequencia_consumo > 0)
);

-- Eventos anteriores ao corte continuam disponíveis para auditoria, mas não
-- entram na fila v2. Todo consumidor v2 faz carga-base antes de registrar
-- checkpoint; assim não existe conversão insegura de checkpoints locais.
insert into public.sincronizacao_operacional_estado
  (chave, corte_sequencia_tecnica, proxima_sequencia_consumo)
select 'fila_v2', coalesce(max(sequencia), 0), 1
  from public.sincronizacao_operacional_eventos
on conflict (chave) do nothing;

create table if not exists public.sincronizacao_operacional_consumidores (
  consumidor_id text primary key,
  sequencia_confirmada bigint not null default 0,
  versao_protocolo integer not null default 2 check (versao_protocolo = 2),
  requer_carga_base boolean not null default true,
  ultimo_heartbeat timestamptz not null default clock_timestamp(),
  criado_em timestamptz not null default clock_timestamp(),
  atualizado_em timestamptz not null default clock_timestamp(),
  check (sequencia_confirmada >= 0)
);

create index if not exists ix_sync_eventos_consumo
  on public.sincronizacao_operacional_eventos(sequencia_consumo)
  where sequencia_consumo is not null;
create index if not exists ix_sync_consumidores_heartbeat
  on public.sincronizacao_operacional_consumidores(ultimo_heartbeat);

alter table public.sincronizacao_operacional_consumidores enable row level security;
revoke all on public.sincronizacao_operacional_consumidores from anon, authenticated;

-- Apenas a alteração de conteúdo de negócio gera evento. Metadados de acesso,
-- sincronização ou atualização não invalidam cache nem multiplicam a trilha.
create or replace function public.registrar_evento_sincronizacao_operacional()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  dados jsonb;
  dados_antigos jsonb;
  dados_novos jsonb;
  chave_primaria jsonb;
  campos_tecnicos text[] := array[
    'updated_at', 'atualizado_em', 'consultado_em', 'sincronizado_em',
    'processado_em', 'acessado_em', 'ultimo_acesso_em'
  ];
begin
  if TG_OP = 'UPDATE' then
    dados_antigos := to_jsonb(OLD) - campos_tecnicos;
    dados_novos := to_jsonb(NEW) - campos_tecnicos;
    if dados_antigos is not distinct from dados_novos then
      return NEW;
    end if;
  end if;

  dados := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
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
  values (TG_TABLE_NAME, TG_OP, chave_primaria, nullif(dados ->> 'empresa_id', ''));
  return coalesce(NEW, OLD);
end;
$$;

-- Um único publicador serializa a entrega. Como ele enxerga somente eventos
-- já confirmados, uma transação longa nunca deixa um "buraco" que permita ao
-- consumidor avançar além de um evento ainda não confirmado.
create or replace function public.publicar_eventos_sincronizacao_operacional(p_limite integer default 1000)
returns table (publicados integer, sequencia_inicial bigint, sequencia_final bigint)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  estado public.sincronizacao_operacional_estado%rowtype;
  quantidade integer := 0;
  inicio bigint := null;
  fim bigint := null;
begin
  if p_limite is null or p_limite < 1 or p_limite > 10000 then
    raise exception 'Limite de publicação deve estar entre 1 e 10000.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sincronizacao_operacional_fila_v2', 0));
  select * into estado
    from public.sincronizacao_operacional_estado
   where chave='fila_v2'
   for update;

  with pendentes_origem as materialized (
    select sequencia
      from public.sincronizacao_operacional_eventos
     where sequencia > estado.corte_sequencia_tecnica
       and sequencia_consumo is null
     order by sequencia
     limit p_limite
     for update skip locked
  ), pendentes as materialized (
    select sequencia, row_number() over (order by sequencia) as ordem
      from pendentes_origem
  ), atribuidos as (
    update public.sincronizacao_operacional_eventos e
       set sequencia_consumo = estado.proxima_sequencia_consumo + p.ordem - 1
      from pendentes p
     where e.sequencia=p.sequencia
     returning e.sequencia_consumo
  )
  select count(*)::integer, min(sequencia_consumo), max(sequencia_consumo)
    into quantidade, inicio, fim
    from atribuidos;

  if quantidade > 0 then
    update public.sincronizacao_operacional_estado
       set proxima_sequencia_consumo=fim + 1, atualizado_em=clock_timestamp()
     where chave='fila_v2';
  end if;
  return query select quantidade, inicio, fim;
end;
$$;

create or replace function public.registrar_consumidor_sincronizacao_operacional(p_consumidor_id text)
returns public.sincronizacao_operacional_consumidores
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare resultado public.sincronizacao_operacional_consumidores%rowtype;
begin
  if nullif(btrim(p_consumidor_id), '') is null then
    raise exception 'Identidade do consumidor é obrigatória.';
  end if;
  insert into public.sincronizacao_operacional_consumidores(consumidor_id)
  values (btrim(p_consumidor_id))
  on conflict (consumidor_id) do update
    set ultimo_heartbeat=clock_timestamp(), atualizado_em=clock_timestamp()
  returning * into resultado;
  return resultado;
end;
$$;

-- O checkpoint só é confirmado depois que o SQLite já concluiu sua transação.
-- Repetir a confirmação é idempotente; regressão é recusada.
create or replace function public.confirmar_checkpoint_sincronizacao_operacional(
  p_consumidor_id text, p_sequencia bigint, p_carga_base_concluida boolean default false
)
returns public.sincronizacao_operacional_consumidores
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare publicado bigint;
declare resultado public.sincronizacao_operacional_consumidores%rowtype;
begin
  select coalesce(max(sequencia_consumo), 0) into publicado
    from public.sincronizacao_operacional_eventos;
  if p_sequencia < 0 or p_sequencia > publicado then
    raise exception 'Checkpoint % está fora da fila publicada (máximo %).', p_sequencia, publicado;
  end if;
  insert into public.sincronizacao_operacional_consumidores as consumidor
    (consumidor_id, sequencia_confirmada, requer_carga_base)
  values (btrim(p_consumidor_id), p_sequencia, not p_carga_base_concluida)
  on conflict (consumidor_id) do update
    set sequencia_confirmada=greatest(consumidor.sequencia_confirmada, excluded.sequencia_confirmada),
        requer_carga_base=case when p_carga_base_concluida then false else consumidor.requer_carga_base end,
        ultimo_heartbeat=clock_timestamp(), atualizado_em=clock_timestamp()
  returning * into resultado;
  return resultado;
end;
$$;

revoke all on function public.publicar_eventos_sincronizacao_operacional(integer) from public;
revoke all on function public.registrar_consumidor_sincronizacao_operacional(text) from public;
revoke all on function public.confirmar_checkpoint_sincronizacao_operacional(text,bigint,boolean) from public;

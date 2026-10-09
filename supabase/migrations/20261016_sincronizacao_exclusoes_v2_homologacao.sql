-- Proteção de exclusões canônicas para a sincronização operacional v2.
-- Não apaga histórico; esta migration só será aplicada após homologação isolada.

create table if not exists public.sincronizacao_operacional_tombstones (
  empresa_id text not null default '',
  tabela text not null,
  chave jsonb not null,
  sequencia_exclusao bigint not null,
  excluido_em timestamptz not null default clock_timestamp(),
  restaurado_em timestamptz,
  restaurado_por text,
  justificativa_restauracao text,
  primary key (empresa_id, tabela, chave)
);

alter table public.sincronizacao_operacional_tombstones enable row level security;
revoke all on public.sincronizacao_operacional_tombstones from anon, authenticated;
grant select on public.sincronizacao_operacional_tombstones to service_role;
grant execute on function public.publicar_eventos_sincronizacao_operacional(integer) to service_role;
grant execute on function public.registrar_consumidor_sincronizacao_operacional(text,text,integer) to service_role;
grant execute on function public.confirmar_checkpoint_sincronizacao_operacional(text,text,bigint,boolean) to service_role;
grant execute on function public.estado_fila_sincronizacao_operacional() to service_role;

-- O gatilho continua ignorando apenas campos explicitamente técnicos, mas agora
-- conserva a exclusão como fato canônico. Uma inserção posterior da mesma
-- identidade é recusada salvo dentro da função de restauração autorizada.
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
  sequencia_evento bigint;
  tombstone public.sincronizacao_operacional_tombstones%rowtype;
  campos_tecnicos text[] := array[
    'updated_at', 'atualizado_em', 'consultado_em', 'sincronizado_em',
    'processado_em', 'acessado_em', 'ultimo_acesso_em'
  ];
begin
  if TG_OP = 'UPDATE' then
    dados_antigos := to_jsonb(OLD) - campos_tecnicos;
    dados_novos := to_jsonb(NEW) - campos_tecnicos;
    if dados_antigos is not distinct from dados_novos then return NEW; end if;
  end if;

  dados := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  select coalesce(jsonb_object_agg(a.attname, dados -> a.attname), '{}'::jsonb)
    into chave_primaria
    from pg_index i
    join unnest(i.indkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
   where i.indrelid=TG_RELID and i.indisprimary;
  if chave_primaria='{}'::jsonb then
    raise exception 'Tabela % não possui chave primária; evento incremental recusado.', TG_TABLE_NAME;
  end if;

  if TG_OP='INSERT' then
    select * into tombstone from public.sincronizacao_operacional_tombstones
     where empresa_id=coalesce(nullif(dados->>'empresa_id',''),'') and tabela=TG_TABLE_NAME and chave=chave_primaria and restaurado_em is null for update;
    if found and coalesce(current_setting('app.sincronizacao_restauracao_autorizada', true),'') <> 'on' then
      raise exception 'Republicação recusada: % % foi excluído canonicamente; use a restauração autorizada.', TG_TABLE_NAME, chave_primaria;
    end if;
    if found then
      update public.sincronizacao_operacional_tombstones
         set restaurado_em=clock_timestamp(), restaurado_por=session_user
       where empresa_id=coalesce(nullif(dados->>'empresa_id',''),'') and tabela=TG_TABLE_NAME and chave=chave_primaria;
    end if;
  end if;

  insert into public.sincronizacao_operacional_eventos(tabela,operacao,chave,empresa_id)
  values (TG_TABLE_NAME,TG_OP,chave_primaria,nullif(dados->>'empresa_id',''))
  returning sequencia into sequencia_evento;

  if TG_OP='DELETE' then
    insert into public.sincronizacao_operacional_tombstones(empresa_id,tabela,chave,sequencia_exclusao)
    values (coalesce(nullif(dados->>'empresa_id',''),''),TG_TABLE_NAME,chave_primaria,sequencia_evento)
    on conflict (empresa_id,tabela,chave) do update set
      sequencia_exclusao=excluded.sequencia_exclusao,
      excluido_em=excluded.excluido_em,
      restaurado_em=null,
      restaurado_por=null,
      justificativa_restauracao=null;
  end if;
  return coalesce(NEW,OLD);
end;
$$;

-- Restaura a linha e encerra o tombstone na mesma transação. Não existe
-- autorização persistente que uma publicação atrasada possa reutilizar.
create or replace function public.restaurar_linha_sincronizacao_operacional(
  p_tabela text, p_linha jsonb, p_justificativa text
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  rel regclass;
  chave_primaria jsonb;
begin
  if nullif(btrim(p_tabela),'') is null or p_linha is null or nullif(btrim(p_justificativa),'') is null then
    raise exception 'Tabela, linha e justificativa de restauração são obrigatórias.';
  end if;
  rel:=to_regclass(format('public.%I',p_tabela));
  if rel is null or not exists (select 1 from pg_trigger where tgrelid=rel and tgname like 'trg_sync_operacional%') then
    raise exception 'Tabela % não é restaurável pela sincronização operacional.', p_tabela;
  end if;
  select coalesce(jsonb_object_agg(a.attname,p_linha->a.attname),'{}'::jsonb) into chave_primaria
    from pg_index i join unnest(i.indkey) with ordinality as k(attnum,ord) on true
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
   where i.indrelid=rel and i.indisprimary;
  if chave_primaria='{}'::jsonb then raise exception 'A linha não possui chave primária restaurável.'; end if;
  perform 1 from public.sincronizacao_operacional_tombstones
   where empresa_id=coalesce(nullif(p_linha->>'empresa_id',''),'') and tabela=p_tabela and chave=chave_primaria and restaurado_em is null for update;
  if not found then raise exception 'Não há exclusão canônica ativa para restaurar.'; end if;
  perform set_config('app.sincronizacao_restauracao_autorizada','on',true);
  execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I,$1)',p_tabela,p_tabela) using p_linha;
  update public.sincronizacao_operacional_tombstones
     set justificativa_restauracao=btrim(p_justificativa)
   where empresa_id=coalesce(nullif(p_linha->>'empresa_id',''),'') and tabela=p_tabela and chave=chave_primaria;
end;
$$;

revoke all on function public.restaurar_linha_sincronizacao_operacional(text,jsonb,text) from public;
grant execute on function public.restaurar_linha_sincronizacao_operacional(text,jsonb,text) to service_role;

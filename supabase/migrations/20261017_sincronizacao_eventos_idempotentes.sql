-- Evita eventos para mudanças puramente técnicas de importação.
-- Não remove histórico nem altera a fila, checkpoints, leases ou tombstones.

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
  -- lote_id e criado_em descrevem a ingestão, não o fato fiscal/cadastral.
  -- Uma reimportação pode recriar o lote local sem alterar o documento.
  campos_tecnicos text[] := array[
    'updated_at', 'atualizado_em', 'consultado_em', 'sincronizado_em',
    'processado_em', 'acessado_em', 'ultimo_acesso_em',
    'lote_id', 'criado_em'
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

revoke all on function public.registrar_evento_sincronizacao_operacional() from public;

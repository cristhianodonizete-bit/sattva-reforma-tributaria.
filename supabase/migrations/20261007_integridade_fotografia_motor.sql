-- Uma execução somente pode substituir a fotografia ativa se ela for um lote
-- completo, coerente com a execução persistida e assinado pelo worker.
-- Em qualquer falha, nenhuma linha ativa é alterada.
create or replace function public.promover_fotografia_motor(
  p_empresa_id bigint,
  p_execucao_id bigint,
  p_quantidade_esperada integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantidade integer;
  v_movimentos_distintos integer;
  v_execucao_valida integer;
begin
  perform pg_advisory_xact_lock(814271, p_empresa_id::integer);

  select count(*) into v_execucao_valida
    from public.motor_execucoes_operacionais
   where id=p_execucao_id
     and empresa_id=p_empresa_id
     and coalesce(dados->>'id','')=p_execucao_id::text
     and coalesce(dados->'integridade'->'entrada'->>'assinatura','') <> ''
     and coalesce(dados->'integridade'->'resultado'->>'assinatura','') <> '';
  if v_execucao_valida <> 1 then
    raise exception 'Execução do motor sem integridade verificável para empresa %, execução %', p_empresa_id, p_execucao_id;
  end if;

  select count(*), count(distinct movimento_id)
    into v_quantidade, v_movimentos_distintos
    from public.motor_resultados_operacionais
   where empresa_id=p_empresa_id and execucao_id=p_execucao_id and ativo=false;

  if v_quantidade <> p_quantidade_esperada or v_quantidade = 0
     or v_movimentos_distintos <> v_quantidade then
    raise exception 'Fotografia incompleta ou duplicada para empresa %, execução %: esperado %, linhas %, itens distintos %',
      p_empresa_id, p_execucao_id, p_quantidade_esperada, v_quantidade, v_movimentos_distintos;
  end if;

  update public.motor_resultados_operacionais
     set ativo=false
   where empresa_id=p_empresa_id and ativo=true;

  update public.motor_resultados_operacionais
     set ativo=true
   where empresa_id=p_empresa_id and execucao_id=p_execucao_id and ativo=false;
end;
$$;

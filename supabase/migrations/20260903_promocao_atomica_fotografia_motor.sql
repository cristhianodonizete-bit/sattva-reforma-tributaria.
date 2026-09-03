-- Promoção atômica da fotografia do motor.
-- Resultados novos entram inativos; a fotografia vigente somente é trocada
-- depois da conferência integral da quantidade esperada de linhas.

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
begin
  perform pg_advisory_xact_lock(814271, p_empresa_id::integer);

  select count(*) into v_quantidade
    from public.motor_resultados_operacionais
   where empresa_id=p_empresa_id and execucao_id=p_execucao_id and ativo=false;

  if v_quantidade <> p_quantidade_esperada or v_quantidade = 0 then
    raise exception 'Fotografia incompleta para empresa %, execução %: esperado %, encontrado %',
      p_empresa_id, p_execucao_id, p_quantidade_esperada, v_quantidade;
  end if;

  update public.motor_resultados_operacionais
     set ativo=false
   where empresa_id=p_empresa_id and ativo=true;

  update public.motor_resultados_operacionais
     set ativo=true
   where empresa_id=p_empresa_id and execucao_id=p_execucao_id and ativo=false;
end;
$$;

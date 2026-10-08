-- Atualização incremental sem fotografia parcial.
--
-- O worker calcula somente os movimentos explicitamente autorizados. Esta
-- função constrói a próxima fotografia completa no servidor: preserva as
-- linhas ativas que não fazem parte do recorte e troca o recorte calculado.
-- Tudo acontece na mesma transação; qualquer erro deixa a fotografia anterior
-- exatamente como estava.
create or replace function public.promover_fotografia_motor_incremental(
  p_empresa_id bigint,
  p_execucao_id bigint,
  p_quantidade_substituta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execucao_anterior bigint;
  v_ativas integer;
  v_substitutas integer;
  v_substitutas_distintas integer;
  v_intactas integer;
  v_total integer;
  v_execucao_valida integer;
begin
  perform pg_advisory_xact_lock(814271, p_empresa_id::integer);

  if p_quantidade_substituta is null or p_quantidade_substituta <= 0 then
    raise exception 'Promoção incremental sem recorte válido para empresa %', p_empresa_id;
  end if;

  select count(*) into v_execucao_valida
    from public.motor_execucoes_operacionais
   where id=p_execucao_id and empresa_id=p_empresa_id
     and coalesce(dados->'integridade'->'entrada'->>'assinatura','') <> ''
     and coalesce(dados->'integridade'->'resultado'->>'assinatura','') <> ''
     and coalesce(dados->'integridade'->>'modo','') = 'INCREMENTAL_IDS_EXPLICITOS';
  if v_execucao_valida <> 1 then
    raise exception 'Execução incremental sem integridade verificável para empresa %, execução %', p_empresa_id, p_execucao_id;
  end if;

  select min(execucao_id), count(*) into v_execucao_anterior, v_ativas
    from public.motor_resultados_operacionais
   where empresa_id=p_empresa_id and ativo=true;
  if v_ativas = 0 or (select count(distinct execucao_id) from public.motor_resultados_operacionais where empresa_id=p_empresa_id and ativo=true) <> 1 then
    raise exception 'Não existe fotografia ativa única para receber atualização incremental da empresa %', p_empresa_id;
  end if;

  select count(*), count(distinct movimento_id)
    into v_substitutas, v_substitutas_distintas
    from public.motor_resultados_operacionais
   where empresa_id=p_empresa_id and execucao_id=p_execucao_id and ativo=false;
  if v_substitutas <> p_quantidade_substituta or v_substitutas_distintas <> v_substitutas then
    raise exception 'Recorte incremental incompleto ou duplicado para empresa %, execução %', p_empresa_id, p_execucao_id;
  end if;

  select count(*) into v_intactas
    from public.motor_resultados_operacionais anterior
   where anterior.empresa_id=p_empresa_id and anterior.execucao_id=v_execucao_anterior and anterior.ativo=true
     and not exists (
       select 1 from public.motor_resultados_operacionais novo
        where novo.empresa_id=p_empresa_id and novo.execucao_id=p_execucao_id
          and novo.movimento_id=anterior.movimento_id
     );

  insert into public.motor_resultados_operacionais (
    empresa_id, movimento_id, dados, tipo_credito, modalidade_credito,
    status_credito_determinacao, regime_cbs_emitente, regime_cbs_adquirente,
    movimento_hash, regra_version, catalogo_version, parceiro_version,
    parametro_version, motor_version, execucao_id, ativo,
    catalogo_cst_resolvido_id, catalogo_cclasstrib_resolvido_id,
    estado_autonomia, codigo_causa, origem_resolucao, evidencia_utilizada,
    regra_vencedora, requer_intervencao_humana, motivo_intervencao,
    autonomia_calculo_cbs_propria, autonomia_credito_entrada,
    autonomia_credito_cliente, autonomia_classificatoria,
    autonomia_diagnostico_completo, memoria_autonomia_dimensoes
  )
  select
    anterior.empresa_id, anterior.movimento_id,
    jsonb_set(anterior.dados, '{execucao_id}', to_jsonb(p_execucao_id), true),
    anterior.tipo_credito, anterior.modalidade_credito,
    anterior.status_credito_determinacao, anterior.regime_cbs_emitente, anterior.regime_cbs_adquirente,
    anterior.movimento_hash, anterior.regra_version, anterior.catalogo_version, anterior.parceiro_version,
    anterior.parametro_version, anterior.motor_version, p_execucao_id, false,
    anterior.catalogo_cst_resolvido_id, anterior.catalogo_cclasstrib_resolvido_id,
    anterior.estado_autonomia, anterior.codigo_causa, anterior.origem_resolucao, anterior.evidencia_utilizada,
    anterior.regra_vencedora, anterior.requer_intervencao_humana, anterior.motivo_intervencao,
    anterior.autonomia_calculo_cbs_propria, anterior.autonomia_credito_entrada,
    anterior.autonomia_credito_cliente, anterior.autonomia_classificatoria,
    anterior.autonomia_diagnostico_completo, anterior.memoria_autonomia_dimensoes
  from public.motor_resultados_operacionais anterior
  where anterior.empresa_id=p_empresa_id and anterior.execucao_id=v_execucao_anterior and anterior.ativo=true
    and not exists (
      select 1 from public.motor_resultados_operacionais novo
       where novo.empresa_id=p_empresa_id and novo.execucao_id=p_execucao_id
         and novo.movimento_id=anterior.movimento_id
    );

  select count(*), count(distinct movimento_id) into v_total, v_substitutas_distintas
    from public.motor_resultados_operacionais
   where empresa_id=p_empresa_id and execucao_id=p_execucao_id and ativo=false;
  if v_total <> v_substitutas_distintas or v_total <> v_intactas + p_quantidade_substituta then
    raise exception 'Fotografia incremental não fechou uma coleção única para empresa %, execução %', p_empresa_id, p_execucao_id;
  end if;

  update public.motor_resultados_operacionais set ativo=false
   where empresa_id=p_empresa_id and ativo=true;
  update public.motor_resultados_operacionais set ativo=true
   where empresa_id=p_empresa_id and execucao_id=p_execucao_id and ativo=false;

  return v_total;
end;
$$;

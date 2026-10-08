require('dotenv').config();
const { Client } = require('pg');

const empresaId = Number(process.argv[2] || 23);
const colunas = `empresa_id,movimento_id,dados,tipo_credito,modalidade_credito,status_credito_determinacao,
  regime_cbs_emitente,regime_cbs_adquirente,movimento_hash,regra_version,catalogo_version,parceiro_version,
  parametro_version,motor_version,execucao_id,ativo,catalogo_cst_resolvido_id,catalogo_cclasstrib_resolvido_id,
  estado_autonomia,codigo_causa,origem_resolucao,evidencia_utilizada,regra_vencedora,requer_intervencao_humana,
  motivo_intervencao,autonomia_calculo_cbs_propria,autonomia_credito_entrada,autonomia_credito_cliente,
  autonomia_classificatoria,autonomia_diagnostico_completo,memoria_autonomia_dimensoes`;

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized:false } });
  await client.connect();
  try {
    await client.query('begin');
    const antes = await client.query(`select count(*)::int quantidade, count(distinct execucao_id)::int execucoes
      from public.motor_resultados_operacionais where empresa_id=$1 and ativo=true`, [empresaId]);
    if (antes.rows[0].quantidade < 2 || antes.rows[0].execucoes !== 1) throw new Error('Empresa não possui fotografia ativa única suficiente para o teste transacional.');
    const amostra = await client.query(`select * from public.motor_resultados_operacionais
      where empresa_id=$1 and ativo=true order by id limit 1`, [empresaId]);
    const novaExecucao = await client.query(`insert into public.motor_execucoes_operacionais(empresa_id,dados)
      values ($1, jsonb_build_object('integridade',jsonb_build_object('entrada',jsonb_build_object('assinatura','teste-transacional'),
      'resultado',jsonb_build_object('assinatura','teste-transacional'),'modo','INCREMENTAL_IDS_EXPLICITOS')))
      returning id`, [empresaId]);
    const execucaoId = Number(novaExecucao.rows[0].id);
    const r = amostra.rows[0];
    await client.query(`insert into public.motor_resultados_operacionais(${colunas}) values (
      $1,$2,jsonb_set($3::jsonb,'{execucao_id}',to_jsonb($4::bigint),true),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$4,false,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
      [empresaId,r.movimento_id,r.dados,execucaoId,r.tipo_credito,r.modalidade_credito,r.status_credito_determinacao,
        r.regime_cbs_emitente,r.regime_cbs_adquirente,r.movimento_hash,r.regra_version,r.catalogo_version,r.parceiro_version,
        r.parametro_version,r.motor_version,r.catalogo_cst_resolvido_id,r.catalogo_cclasstrib_resolvido_id,r.estado_autonomia,
        r.codigo_causa,r.origem_resolucao,r.evidencia_utilizada,r.regra_vencedora,r.requer_intervencao_humana,r.motivo_intervencao,
        r.autonomia_calculo_cbs_propria,r.autonomia_credito_entrada,r.autonomia_credito_cliente,r.autonomia_classificatoria,
        r.autonomia_diagnostico_completo,r.memoria_autonomia_dimensoes]);
    const promovida = await client.query('select public.promover_fotografia_motor_incremental($1,$2,$3) as quantidade', [empresaId,execucaoId,1]);
    const depois = await client.query(`select count(*)::int quantidade, count(distinct execucao_id)::int execucoes,
      min(execucao_id)::bigint execucao from public.motor_resultados_operacionais where empresa_id=$1 and ativo=true`, [empresaId]);
    if (depois.rows[0].quantidade !== antes.rows[0].quantidade || depois.rows[0].execucoes !== 1 || Number(depois.rows[0].execucao) !== execucaoId || Number(promovida.rows[0].quantidade) !== antes.rows[0].quantidade) {
      throw new Error(`Promoção incremental inválida: antes=${JSON.stringify(antes.rows[0])}, depois=${JSON.stringify(depois.rows[0])}`);
    }
    console.log(JSON.stringify({ empresa_id:empresaId, antes:antes.rows[0], depois:depois.rows[0], rollback:true }));
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

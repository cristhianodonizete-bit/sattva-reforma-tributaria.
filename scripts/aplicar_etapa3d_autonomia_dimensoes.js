const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');
const { avaliarDimensoes } = require('../src/services/autonomiaDimensoes');
const EQUIVALENTES = new Set(['0105', '0107', '1702']);
const lc116 = (codigo) => String(codigo || '').replace(/\D/g, '').slice(0, 4);
async function fotografia(client) {
  const { rows } = await client.query(`select count(*)::int resultados, coalesce(sum((dados->>'cbs')::numeric),0)::text cbs from public.motor_resultados_operacionais where empresa_id=1 and execucao_id=14 and ativo=true`);
  return rows[0];
}
(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const antes = await fotografia(client);
    await client.query('begin');
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260905_autonomia_dimensoes_fiscais.sql'), 'utf8'));
    const { rows } = await client.query(`select r.id,r.dados,r.requer_intervencao_humana,m.cst,m.sentido from public.motor_resultados_operacionais r join public.movimentos m on m.id=r.movimento_id where r.empresa_id=1 and r.execucao_id=14 and r.ativo=true`);
    const totais = { total: rows.length, saidas: 0, entradas: 0, legado: 0, calculoCbs: 0, creditoEntrada: 0, creditoCliente: 0, classificatoria: 0, diagnosticoCompleto: 0, saidasLiberadas: 0 };
    const atualizacoes = rows.map((linha) => {
      const dados = linha.dados || {};
      const equivalentes = linha.sentido === 'saida' && EQUIVALENTES.has(lc116(linha.cst));
      const dimensoes = avaliarDimensoes({ ...dados, sentido: linha.sentido }, { nbsEquivalentes: equivalentes });
      const autonomiaLegada = !linha.requer_intervencao_humana;
      const calculoCbs = linha.sentido === 'saida' ? (autonomiaLegada || dimensoes.autonomia_calculo_cbs_propria) : null;
      const diagnosticoCompleto = autonomiaLegada && !equivalentes ? true : dimensoes.autonomia_diagnostico_completo;
      if (autonomiaLegada) totais.legado++;
      if (linha.sentido === 'saida') {
        totais.saidas++;
        if (calculoCbs) totais.calculoCbs++;
        if (dimensoes.autonomia_credito_cliente === true) totais.creditoCliente++;
        if (equivalentes && dimensoes.autonomia_calculo_cbs_propria && !autonomiaLegada) totais.saidasLiberadas++;
      } else {
        totais.entradas++;
        if (autonomiaLegada) totais.calculoCbs++;
        if (dimensoes.autonomia_credito_entrada === true) totais.creditoEntrada++;
      }
      if (autonomiaLegada || dimensoes.autonomia_classificatoria !== 'INDETERMINADA') totais.classificatoria++;
      if (diagnosticoCompleto) totais.diagnosticoCompleto++;
      return { id: linha.id, calculo_cbs: calculoCbs, credito_entrada: dimensoes.autonomia_credito_entrada, credito_cliente: dimensoes.autonomia_credito_cliente, classificatoria: dimensoes.autonomia_classificatoria, diagnostico_completo: diagnosticoCompleto, memoria: { ...dimensoes.memoria, versoes_catalogo: { nbs: '1.00.00', cst: '2026-06-22', cclasstrib: '2026-06-22' }, contexto: { lc116: lc116(linha.cst), multiplas_nbs_equivalentes: equivalentes, autonomia_global_legada: autonomiaLegada } } };
    });
    await client.query(`update public.motor_resultados_operacionais r set autonomia_calculo_cbs_propria=u.calculo_cbs, autonomia_credito_entrada=u.credito_entrada, autonomia_credito_cliente=u.credito_cliente, autonomia_classificatoria=u.classificatoria, autonomia_diagnostico_completo=u.diagnostico_completo, memoria_autonomia_dimensoes=u.memoria from jsonb_to_recordset($1::jsonb) as u(id bigint, calculo_cbs boolean, credito_entrada boolean, credito_cliente boolean, classificatoria text, diagnostico_completo boolean, memoria jsonb) where r.id=u.id`, [JSON.stringify(atualizacoes)]);
    const taxa = (valor, denominador) => denominador ? valor / denominador : null;
    await client.query(`update public.telemetria_autonomia_execucoes set taxa_autonomia_calculo_cbs_propria=$1,taxa_autonomia_credito_entrada=$2,taxa_autonomia_credito_cliente=$3,taxa_autonomia_classificatoria=$4,taxa_autonomia_diagnostico_completo=$5,dimensoes_json=$6,atualizado_em=now() where execucao_id=14`, [taxa(totais.calculoCbs, totais.total), taxa(totais.creditoEntrada, totais.entradas), taxa(totais.creditoCliente, totais.saidas), taxa(totais.classificatoria, totais.total), taxa(totais.diagnosticoCompleto, totais.total), totais]);
    await client.query('commit');
    const depois = await fotografia(client);
    console.log(JSON.stringify({ antes, depois, metricas: totais, fiscal_igual: antes.resultados === depois.resultados && antes.cbs === depois.cbs }, null, 2));
  } catch (erro) {
    try { await client.query('rollback'); } catch (_) { /* transação não iniciada */ }
    throw erro;
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

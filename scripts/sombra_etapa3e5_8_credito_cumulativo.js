const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');
const { resolverCreditoPisCofinsAdquirente } = require('../src/engine/calculadora');
const { avaliarDimensoes } = require('../src/services/autonomiaDimensoes');

const relatorio = path.join('C:', 'Users', 'cristhiano', 'Documents', 'Reforma Tributária', 'relatorio_etapa3b_bloqueios.json');
const alvo = new Set(JSON.parse(fs.readFileSync(relatorio)).rows
  .filter((r) => r.entrada_saida === 'entrada' && r.bloqueio_pis_cofins === 'PIS_COFINS_ZERO_NAO_CONCLUSIVO')
  .map((r) => Number(r.movimento_id)));

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`select r.id, r.empresa_id, r.movimento_id, m.sentido,
      autonomia_credito_entrada, autonomia_diagnostico_completo, dados
      from public.motor_resultados_operacionais r join public.movimentos m on m.id=r.movimento_id
      where r.execucao_id=14 and r.ativo=true`);
    const empresaIds = [...new Set(rows.filter((r) => alvo.has(Number(r.movimento_id))).map((r) => r.empresa_id))];
    if (empresaIds.length !== 1) throw new Error('O conjunto shadow deve pertencer a uma única empresa.');
    const empresa = (await client.query('select regime from empresas where id=$1', [empresaIds[0]])).rows[0];
    const entradas = rows.filter((r) => r.sentido === 'entrada');
    const alvoRows = entradas.filter((r) => alvo.has(Number(r.movimento_id)));
    const decisoes = alvoRows.map((r) => ({ linha: r, decisao: resolverCreditoPisCofinsAdquirente({ regimeAdquirente: empresa.regime }) }));
    const antesCredito = entradas.filter((r) => r.autonomia_credito_entrada === true).length;
    const depoisCredito = entradas.filter((r) => {
      const s = decisoes.find((x) => x.linha.id === r.id);
      return s ? s.decisao.status === 'DETERMINADO' : r.autonomia_credito_entrada === true;
    }).length;
    const antesDiagnostico = rows.filter((r) => r.autonomia_diagnostico_completo === true).length;
    const depoisDiagnostico = rows.filter((r) => {
      const s = decisoes.find((x) => x.linha.id === r.id);
      if (!s) return r.autonomia_diagnostico_completo === true;
      const dados = typeof r.dados === 'string' ? JSON.parse(r.dados || '{}') : (r.dados || {});
      return avaliarDimensoes({ ...dados, sentido: r.sentido, base_economica: dados.baseEconomica, cbs: dados.cbs,
        cclasstrib: dados.classificacao?.cclasstrib, status_credito_determinacao: dados.credito?.statusDeterminacao,
        status_credito: dados.credito?.status, credito_pis_cofins_adquirente: s.decisao }).autonomia_diagnostico_completo === true;
    }).length;
    const qtd = (tipo) => decisoes.filter((x) => x.decisao.classificacao === tipo).length;
    const pct = (n, d) => Number((n / d * 100).toFixed(2));
    console.log(JSON.stringify({
      operacoes_shadow_analisadas: alvoRows.length,
      regime_adquirente: empresa.regime,
      operacoes_regra_aplicavel: qtd('CREDITO_NAO_ELEGIVEL_POR_REGIME'),
      credito_nao_elegivel_determinado: qtd('CREDITO_NAO_ELEGIVEL_POR_REGIME'),
      credito_ainda_indeterminado: qtd('CREDITO_INDETERMINADO'),
      excecoes_por_regra_especifica: decisoes.filter((x) => x.decisao.origem === 'REGRA_ESPECIFICA').length,
      autonomia_credito_entrada_antes: pct(antesCredito, entradas.length),
      autonomia_credito_entrada_depois: pct(depoisCredito, entradas.length),
      ganho_autonomia_credito_entrada_pp: Number((pct(depoisCredito, entradas.length) - pct(antesCredito, entradas.length)).toFixed(2)),
      autonomia_diagnostico_completo_depois: pct(depoisDiagnostico, rows.length),
      resultados_persistidos_modificados: false,
    }, null, 2));
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

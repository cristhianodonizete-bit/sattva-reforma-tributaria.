const assert = require('assert');
const integra = require('../src/services/integraContador');

const env = { INTEGRA_CONTADOR_BASE_URL: 'https://homologacao.exemplo', INTEGRA_CONTADOR_ACCESS_TOKEN: 'segredo' };
assert.strictEqual(integra.status(env).configurado, true);
assert.strictEqual(integra.status({}).configurado, false);

(async () => {
  let chamada;
  const resposta = await integra.consultarDeclaracoes({ cnpj: '37.605.002/0001-14', anoCalendario: 2026 }, { env, fetchImpl: async (url, opcoes) => {
    chamada = { url, opcoes }; return { ok: true, status: 200, text: async () => JSON.stringify({ success:true, data:{ declaracoes:[{ periodoApuracao:'202606', receitaBruta:12500.5, valorDas:775.3 }] } }) };
  } });
  assert.match(chamada.url, /consultar-declaracoes$/);
  assert.strictEqual(JSON.parse(chamada.opcoes.body).contribuinte.numero, '37605002000114');
  const declaracoes = integra.declaracoesPorCompetencia(resposta, ['2026-06']);
  assert.strictEqual(declaracoes.length, 1);
  assert.strictEqual(declaracoes[0].campos.find((x) => x.campo === 'das').valor_extraido, 775.3);
  console.log('Integra Contador: consulta PGDAS-D somente leitura e normalização auditável aprovadas.');
})().catch((e) => { console.error(e); process.exit(1); });

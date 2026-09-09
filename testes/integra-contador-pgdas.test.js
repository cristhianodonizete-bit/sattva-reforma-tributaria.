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
const variacao = integra.declaracoesPorCompetencia({ retorno: { itens: [{ periodoDeApuracao: '06/2026', valorDocumentoArrecadacao: '775,30' }] } }, ['2026-06']);
assert.strictEqual(variacao.length, 1);
assert.strictEqual(integra.diagnosticoDeclaracoes({ retorno: { itens: [{ periodoDeApuracao: '06/2026', valorDocumentoArrecadacao: '775,30' }] } }, ['2026-06']).objetos_com_das, 1);
  const serpro = { INTEGRA_CONTADOR_BASE_URL: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/', INTEGRA_CONTADOR_ACCESS_TOKEN: 'x', INTEGRA_CONTADOR_JWT_TOKEN: 'y', INTEGRA_CONTADOR_CONTRATANTE_NUMERO: '16967295000100', INTEGRA_CONTADOR_AUTOR_NUMERO: '16967295000100' };
  let consulta;
  await integra.consultarDeclaracoes({ cnpj: '37605002000114', anoCalendario: 2026 }, { env: serpro, fetchImpl: async (url, opcoes) => {
    consulta = { url, opcoes }; return { ok:true, status:200, text:async()=>JSON.stringify({dados:'{"declaracoes":[]}',mensagens:[]}) };
  } });
  assert.match(consulta.url, /\/Consultar$/);
  assert.strictEqual(JSON.parse(consulta.opcoes.body).pedidoDados.idServico, 'CONSDECLARACAO13');
  let procuracao;
  const diagnostico = await integra.verificarProcuracao({ cnpj: '37605002000114' }, { env: serpro, fetchImpl: async (url, opcoes) => {
    procuracao = { url, opcoes }; return { ok:true, status:200, text:async()=>JSON.stringify({ dados:'[{"dtexpiracao":"20291231","sistemas":["PGDAS-D - a partir de 01/2018"]}]' }) };
  } });
  assert.match(procuracao.url, /\/Consultar$/);
  assert.strictEqual(JSON.parse(procuracao.opcoes.body).pedidoDados.idServico, 'OBTERPROCURACAO41');
  assert.strictEqual(diagnostico.procuracao_encontrada, true);
  assert.match(diagnostico.sistemas[0], /PGDAS-D/);
  await assert.rejects(() => integra.consultarDeclaracoes({ cnpj: '17796012000177', anoCalendario: 2026 }, { env: serpro, fetchImpl: async () => ({ ok:false, status:403, text:async()=>JSON.stringify({ contratante:{ numero:'16967295000100' } }) }) }), /procuração eletrônica e-CAC 00146/);
  console.log('Integra Contador: consulta PGDAS-D somente leitura e normalização auditável aprovadas.');
})().catch((e) => { console.error(e); process.exit(1); });

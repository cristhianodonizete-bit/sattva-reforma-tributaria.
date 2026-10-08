const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-custas-'));
const { projetarItem } = require('../src/engine/motor');

const taxa = projetarItem({
  valor: 456.16,
  descricao: 'Legais e Judiciais',
  historico: 'PAGAMENTO DE BOLETO OUTROS BANCOS TRIBUNAL DA JUSTICA DO ES - Recursal 1ª Instância',
  conta: '5130 Depósito Judicial',
  entradaManual: { itemChave: '3_7_03_015_005_LEGAIS_E_JUDICIAIS', geraCredito: false },
}, {
  sentido: 'entrada', ano: 2027,
  empresa: { regime: 'lucro_real' }, regimeContraparte: 'simples_nacional',
});

assert.equal(taxa.precoAtual, 456.16);
assert.equal(taxa.baseEconomica, 456.16, 'não pode retirar PIS/Cofins histórico presumido da taxa');
assert.equal(taxa.cbs, 0);
assert.equal(taxa.creditoCbs, 0);
assert.equal(taxa.creditoPisCofinsAdquirente.valor, 0);
assert.equal(taxa.classificacao.cst, '');
assert.equal(taxa.classificacao.cclasstrib, '');
assert.equal(taxa.credito.status, 'PROJECAO_CONCLUIDA');
assert.ok(taxa.projecaoCustaTaxaJudicial);

const legalGenerico = projetarItem({
  valor: 456.16, descricao: 'Legais e Judiciais',
  historico: 'Serviço jurídico sem detalhe suficiente',
  entradaManual: { itemChave: '3_7_03_015_005_LEGAIS_E_JUDICIAIS', geraCredito: false },
}, {
  sentido: 'entrada', ano: 2027,
  empresa: { regime: 'lucro_real' }, regimeContraparte: 'simples_nacional',
});
assert.equal(legalGenerico.projecaoCustaTaxaJudicial, null,
  'a regra automática exige evidência judicial explícita; não pode reclassificar toda despesa legal');

console.log('custas-depositos-judiciais.test: taxa judicial sem CBS e sem crédito: OK');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-honorarios-'));
const db = require('../src/db');
const { projetarItem } = require('../src/engine/motor');

// Reproduz a alíquota-padrão exibida no exemplo do cadastro, sem tocar na
// parametrização de nenhuma empresa real.
db.prepare('UPDATE param_aliquotas SET cbs=.0921 WHERE ano=2027').run();

const valor = 441.60;
const resultado = projetarItem({
  valor, valor_total: valor, descricao: 'Honorários advocatícios mensais',
  entradaManual: { itemChave: 'HONORARIOS_ADVOCATICIOS_ART_127', geraCredito: true },
  declarado: { cst: '200', cclasstrib: '200052' },
}, {
  sentido: 'entrada', ano: 2027,
  empresa: { regime: 'lucro_real' }, regimeContraparte: 'lucro_real',
});

assert.equal(resultado.classificacao.cst, '200');
assert.equal(resultado.classificacao.cclasstrib, '200052');
assert.equal(resultado.aliquotas.reducaoCbs, 0.30);
assert.equal(resultado.baseEconomica, valor);
assert.equal(resultado.cbs, 28.47, '9,21% x 70% sobre R$ 441,60 deve resultar em R$ 28,47');
assert.equal(resultado.creditoCbs, 28.47, 'adquirente regular recebe o crédito projetado da operação elegível');
assert.equal(resultado.creditoPisCofinsAdquirente.valor, 0);
assert.equal(resultado.creditoPisCofinsAdquirente.classificacao, 'CREDITO_HISTORICO_ZERO_HONORARIOS_ADVOCATICIOS');
assert.equal(resultado.credito.elegibilidadeLegal.status, 'HIPOTESE_PROJECAO');
assert.ok(resultado.projecaoHonorarioAdvocaticio);

const custoJudicial = projetarItem({
  valor, descricao: 'Custas judiciais',
  entradaManual: { itemChave: '3_7_03_015_005_LEGAIS_E_JUDICIAIS', geraCredito: false },
}, {
  sentido: 'entrada', ano: 2027,
  empresa: { regime: 'lucro_real' }, regimeContraparte: 'lucro_real',
});
assert.equal(custoJudicial.projecaoHonorarioAdvocaticio, null,
  'a natureza ampla de legais e judiciais não pode receber automaticamente o tratamento de advocacia');
assert.notEqual(custoJudicial.classificacao.cclasstrib, '200052');

console.log('honorarios-advocaticios-projecao.test: redução condicionada e custos excluídos: OK');

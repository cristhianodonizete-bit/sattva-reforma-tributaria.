const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-credito-cbs-'));
const db = require('../src/db');
const regras = require('../src/services/regras');
const { avaliarCredito, projetarItem } = require('../src/engine/motor');
const cls = { status: 'CLASSIFICADO' };
const regular = avaliarCredito({ regimeAdquirente: 'lucro_real', regimeFornecedor: 'lucro_real', cls });
assert.deepEqual([regular.tipoCredito, regular.statusDeterminacao], ['NORMAL', 'DETERMINADO']);
const simplesConhecido = avaliarCredito({ regimeAdquirente: 'lucro_real', regimeFornecedor: 'simples_nacional', cls, simplesFornecedorConhecido: true });
assert.deepEqual([simplesConhecido.tipoCredito, simplesConhecido.modalidadeCredito, simplesConhecido.statusDeterminacao], ['SIMPLES', 'LIMITADO_CBS_SIMPLES', 'DETERMINADO']);
const simplesIndeterminado = avaliarCredito({ regimeAdquirente: 'lucro_real', regimeFornecedor: 'simples_nacional', cls, simplesFornecedorConhecido: false });
assert.deepEqual([simplesIndeterminado.tipoCredito, simplesIndeterminado.statusDeterminacao], ['SIMPLES', 'INDETERMINADO']);
const simplesPremissa = avaliarCredito({ regimeAdquirente: 'lucro_real', regimeFornecedor: 'simples_nacional', cls, simplesFornecedorReferencia: 0.025 });
assert.deepEqual([simplesPremissa.tipoCredito, simplesPremissa.modalidadeCredito, simplesPremissa.statusDeterminacao], ['SIMPLES', 'LIMITADO_CBS_SIMPLES', 'DETERMINADO_POR_PREMISSA']);
const meiPresumido = avaliarCredito({ regimeAdquirente: 'lucro_real', regimeFornecedor: 'mei', cls: { ...cls, creditoPresumido: true } });
assert.deepEqual([meiPresumido.tipoCredito, meiPresumido.statusDeterminacao], ['PRESUMIDO', 'DETERMINADO']);
const meiSemHipotese = avaliarCredito({ regimeAdquirente: 'lucro_real', regimeFornecedor: 'mei', cls });
assert.deepEqual([meiSemHipotese.tipoCredito, meiSemHipotese.statusDeterminacao], ['SEM_CREDITO', 'DETERMINADO']);
const insuficiente = avaliarCredito({ regimeAdquirente: 'lucro_real', regimeFornecedor: null, cls });
assert.equal(insuficiente.statusDeterminacao, 'INDETERMINADO');
assert.notEqual(insuficiente.tipoCredito, 'SEM_CREDITO');

// A premissa CBS do Simples é a referência operacional da compra: ela precisa
// prevalecer sobre qualquer informação de faixa/DAS eventualmente disponível.
db.prepare("UPDATE param_regimes SET credito_cbs_simples_referencia = ? WHERE chave = 'simples_nacional'").run(0.025);
regras.invalidar();
const compraSimples = projetarItem({
  valor: 1000, valor_total: 1000, cfop: '1102', descricao: 'Item de teste', cst: '000',
}, {
  sentido: 'entrada', ano: 2027, empresa: { regime: 'lucro_real' }, regimeContraparte: 'simples_nacional',
  simplesEmitente: { aliquotaEfetiva: 0.08, reparticao: { pis: 0.02, cofins: 0.03 }, origem: 'faturamento conhecido' },
});
assert.equal(compraSimples.cbs, Math.round(compraSimples.baseEconomica * 0.025 * 100) / 100);
assert.equal(compraSimples.natureza, 'SIMULADO');
console.log('credito-cbs.test: cenários de crédito e premissa CBS do Simples validados');

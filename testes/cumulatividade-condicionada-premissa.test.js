const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-cumulatividade-condicionada-'));
const { resolver } = require('../src/services/catalogoFiscal');

const resolucao = resolver({
  valor: 1000,
  condicao_material_pendente: true,
  catalogo_fiscal: {
    tratamento_pis_cofins: 'NORMAL',
    cumulatividade_obrigatoria: 'SIM',
    grau_determinacao: 'CONDICIONADO AO TIPO DE ESTABELECIMENTO/PRESTAÇÃO',
    condicao_cumulatividade: 'A regra depende do tipo de estabelecimento.',
  },
});

assert.equal(resolucao.percentual, 3.65);
assert.equal(resolucao.valor, 36.5);
assert.equal(resolucao.natureza, 'SIMULADO');
assert.equal(resolucao.origem, 'PREMISSA_CUMULATIVIDADE_CONDICIONAL');
assert.equal(resolucao.metodo, 'PREMISSA_CUMULATIVIDADE_CONDICIONAL_365');
assert.match(resolucao.justificativa, /retirar PIS\/Cofins da base/i);

console.log('Premissa de cumulatividade condicionada: OK');

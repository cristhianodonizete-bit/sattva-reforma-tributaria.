const assert = require('assert');
const { extrairIdentidade } = require('../src/services/documentoFiscalPdf');

const identidade = extrairIdentidade(`
  DANFE - Documento Auxiliar da Nota Fiscal Eletrônica
  Chave de Acesso: 35260912345678000199550010000001234567890123
  CNPJ: 12.345.678/0001-99
  Série: 1  Número: 123
  Data de Emissão: 21/09/2026
  Valor Total da Nota R$ 1.234,56
`);
assert.equal(identidade.chave, '35260912345678000199550010000001234567890123');
assert.equal(identidade.cnpj, '12345678000199');
assert.equal(identidade.serie, '1');
assert.equal(identidade.documento, '123');
assert.equal(identidade.data_emissao, '2026-09-21');
assert.equal(identidade.valor_total, 1234.56);
assert.equal(extrairIdentidade('PDF sem conteúdo fiscal').chave, null);
console.log('documento-fiscal-pdf.test.js: OK');

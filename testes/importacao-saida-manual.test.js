const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { importarMovimentos } = require('../src/services/importador');

function planilha(linha) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([linha]), 'Saidas');
  return XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
}

const base = {
  Cliente:'CLIENTE EXEMPLO LTDA', CNPJ:'12.345.678/0001-90',
  'Número do Documento':'1001', Série:'1', 'Modelo do Documento':'NF-e',
  'Data de Emissão':'15/01/2026', Competência:'2026-01', CFOP:'5102',
  'Descrição Produto':'Produto vendido', Valor:'1.500,00',
};

const valido = importarMovimentos(planilha(base), 'cliente');
assert.equal(valido.registros.length, 1);
assert.equal(valido.registros[0].cfop, '5102');
assert.equal(valido.registros[0].modelo_documento_fiscal, 'nfe');
assert.equal(valido.registros[0].data_emissao, '2026-01-15');

const semCfop = importarMovimentos(planilha({ ...base, CFOP:'' }), 'cliente');
assert.equal(semCfop.registros.length, 0);
assert.match(semCfop.mensagens.join(' '), /CFOP/i);

console.log('importacao-saida-manual.test: OK');

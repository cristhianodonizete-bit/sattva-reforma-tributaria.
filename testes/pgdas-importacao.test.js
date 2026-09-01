const assert = require('assert');
const XLSX = require('xlsx');
const { importarPgdas } = require('../src/services/importador');

function planilha(linhas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'PGDAS');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const completo = importarPgdas(planilha([
  { 'Período': '01/2026', 'Receita Bruta': '10.000,00', 'Receita Serviços': '10.000,00', 'Valor DAS': '650,50', PIS: '0', COFINS: '' },
]));
assert.strictEqual(completo.registros.length, 1);
assert.deepStrictEqual(completo.registros[0], {
  competencia: '2026-01', das: 650.5, receita_bruta: 10000,
  receita_mercadorias: null, receita_servicos: 10000, receita_exportacao: null,
  pis: 0, cofins: null,
});

const parcial = importarPgdas(planilha([
  { Competência: '2026-02', DAS: '500' },
  { Competência: '2026-13', DAS: '100' },
  { Competência: '2026-03', DAS: 'valor inválido' },
]));
assert.strictEqual(parcial.registros.length, 1, 'Somente a linha com competência e DAS válidos deve ser aceita');
assert.strictEqual(parcial.ignorados, 2);
assert.strictEqual(parcial.registros[0].receita_bruta, null, 'Ausência deve permanecer nula, nunca zero');

console.log('PGDAS: importação XLSX/CSV, campos opcionais e ausência preservada aprovados.');

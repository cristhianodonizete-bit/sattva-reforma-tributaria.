const assert = require('assert');
const XLSX = require('xlsx');
const { importarFolhas, importarReceitasSemDfe } = require('../src/services/importador');

function planilha(linhas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Dados');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const folhas = importarFolhas(planilha([
  { Período: '01/2026', 'Valor da Folha': '12.500,00', 'Pró-labore': '2.500,00', Referência: 'Folha janeiro' },
  { Período: '13/2026', 'Valor da Folha': 100 },
]));
assert.strictEqual(folhas.registros.length, 1);
assert.strictEqual(folhas.ignorados, 1);
assert.deepStrictEqual(folhas.registros[0], { competencia: '2026-01', valor_folha: 12500, pro_labore: 2500, referencia_arquivo: 'Folha janeiro' });

const receitas = importarReceitasSemDfe(planilha([
  { Competência: '2026-01', 'Item de receita': 'Locação de equipamentos / bens móveis', Descrição: 'Locação de equipamento', Valor: '3.500,00', 'Identificador Questor': '38988' },
  { Competência: '2026-01', 'Item de receita': '', Descrição: 'Linha inválida', Valor: 100 },
]));
assert.strictEqual(receitas.registros.length, 1);
assert.strictEqual(receitas.ignorados, 1);
assert.deepStrictEqual(receitas.registros[0], {
  competencia: '2026-01', item_receita_chave: 'Locação de equipamentos / bens móveis', descricao: 'Locação de equipamento', valor: 3500,
  evidencia: null, identificador_origem: '38988', origem: null,
});

console.log('Dados complementares: importação de folha e receitas sem DF-e aprovada.');

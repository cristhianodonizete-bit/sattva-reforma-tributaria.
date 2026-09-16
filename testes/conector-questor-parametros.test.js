const assert = require('assert');
const { parametrosConsultaConfirmados } = require('../conector-questor/parametrosConsulta');

const metadados = JSON.stringify({ Parametros: [
  { Name: 'pCodigoEmpresa' }, { Name: 'pDataInicial' },
  { Name: 'pDataFinal' }, { Name: 'pTipoEspecie' },
] });
assert.deepStrictEqual(parametrosConsultaConfirmados(metadados, {
  codigo_questor: 345, inicio: '2026-06-01', fim: '2026-06-30', especie: 'REC',
}), { pCodigoEmpresa: 345, pDataInicial: '01/06/2026', pDataFinal: '30/06/2026', pTipoEspecie: 'REC' });
assert.throws(() => parametrosConsultaConfirmados(JSON.stringify({ Parametros: [{ Name: 'pCodigoEmpresa' }] }), {}), /Nenhum lançamento foi importado/);
const conector = require('fs').readFileSync(require('path').join(__dirname, '..', 'conector-questor', 'index.js'), 'utf8');
assert.match(conector, /texto\.slice\(0,4000\)/, 'o retorno de erro do nWeb precisa preservar a exceção interna');
assert.match(conector, /nFisRRResumoConfLctoFisSaiGrafico/, 'locações devem usar o relatório nWeb de Conferência de Saídas');
assert.match(conector, /PESPECIE:'pEspecie'/, 'o filtro Espécie do relatório deve chegar ao nWeb como pEspecie');
assert.doesNotMatch(conector, /acaoMetadados|parametrosConsultaConfirmados/, 'a tela de consulta não pode ser tratada como relatório');
console.log('OK: parâmetros de locações são extraídos exclusivamente dos metadados do Questor.');

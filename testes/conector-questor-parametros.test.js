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
assert.match(conector, /function nomeAcaoParaMetadados/, 'metadados devem consultar a action, não o nome interno da tela');
assert.match(conector, /_AActionName:acaoMetadados/, 'a consulta de locações deve usar a action confirmada pelo Questor');
console.log('OK: parâmetros de locações são extraídos exclusivamente dos metadados do Questor.');

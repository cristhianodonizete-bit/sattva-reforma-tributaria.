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
console.log('OK: parâmetros de locações são extraídos exclusivamente dos metadados do Questor.');

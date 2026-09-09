const assert = require('node:assert/strict');
const perfil = require('../src/services/questorParametrosRelatorio');

const campos = perfil.camposRetornados('{"parametros":"{\\"Name\\":\\"pDataInicial\\"} {\\"Name\\":\\"pDataFinal\\"} {\\"Name\\":\\"pModelo\\"} {\\"Name\\":\\"pCodigoEmpresa\\"}"}');
assert.deepEqual(campos.sort(), ['PCODIGOEMPRESA','PDATAFINAL','PDATAINICIAL','PMODELO']);
const descoberto = perfil.construir({ competencia:'2026-07', codigoEmpresa:'824', campos });
assert.deepEqual(descoberto.parametros, { PMODELO:'2', PDATAINICIAL:'2026-07-01', PDATAFINAL:'2026-07-31', PCODIGOEMPRESA:'824' });
assert.equal(descoberto.modo, 'DESCOBERTO_NO_QUESTOR');
const padrao = perfil.construir({ competencia:'2026-02', codigoEmpresa:'9' });
assert.equal(padrao.parametros.PDATAFINAL, '2026-02-28');
assert.equal(padrao.parametros.PTIPOMOVIMENTO, '1;2');
console.log('questor-parametros-relatorio: perfil descoberto e fallback compatível: OK');

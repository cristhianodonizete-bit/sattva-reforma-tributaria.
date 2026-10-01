const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const telas = fs.readFileSync(require.resolve('../public/js/telas'), 'utf8');
const rota = api.slice(api.indexOf("router.get('/empresas/:id/creditos-cbs/entradas'"), api.indexOf('\nfunction analisarPerfil'));

assert.match(rota, /garantirEmpresaPermitida/, 'a rastreabilidade exige empresa autorizada');
assert.match(rota, /motorExec\.ultimaExecucao/, 'a consulta é limitada à fotografia mais recente do motor');
assert.match(rota, /r\.sentido='entrada'/, 'a consulta não mistura saídas');
assert.match(rota, /COALESCE\(r\.credito_cbs,0\)>0/, 'a lista contém somente entradas que efetivamente possuem crédito CBS');
assert.match(rota, /r\.execucao_id=\?/, 'a consulta não mistura resultados de execuções anteriores');
assert.doesNotMatch(rota, /motorExec\.executar|reprocessar|INSERT|UPDATE|DELETE/, 'a rota é somente leitura e não reprocessa ou altera dados');
assert.match(telas, /Entradas que geram crédito CBS/, 'a cadeia de fornecedores expõe a rastreabilidade na interface');
assert.match(telas, /creditos-cbs\/entradas/, 'a interface lê o endpoint específico de crédito');

console.log('rastreabilidade-credito-cbs: leitura materializada e segregação de entradas: OK');

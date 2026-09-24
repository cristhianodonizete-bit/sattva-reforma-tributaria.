const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const telas = fs.readFileSync(require.resolve('../public/js/telas'), 'utf8');
const inicio = api.indexOf('function listarDocumentosFiscais');
const fim = api.indexOf('function filtrarDocumentosFiscais', inicio);
const bloco = api.slice(inicio, fim);

assert.match(bloco, /LIMIT \? OFFSET \?/, 'lista fiscal usa paginação no banco');
assert.match(bloco, /limite=0/, 'exportação explícita pode buscar o conjunto completo');
assert.match(telas, /documentosFiscaisPagina/, 'interface guarda página da lista fiscal');
assert.match(telas, /limite=\$\{filtrosAtivos \? 2000 : 100\}/, 'abertura sem filtro busca somente uma página');
console.log('documentos-fiscais-paginacao: lista paginada e exportação integral: OK');

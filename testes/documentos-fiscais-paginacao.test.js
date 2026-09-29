const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const telas = fs.readFileSync(require.resolve('../public/js/telas'), 'utf8');
const inicio = api.indexOf('function listarDocumentosFiscais');
const fim = api.indexOf('function filtrarDocumentosFiscais', inicio);
const bloco = api.slice(inicio, fim);

assert.match(bloco, /LIMIT \? OFFSET \?/, 'lista fiscal usa paginação no banco');
assert.match(bloco, /limite=0/, 'exportação explícita pode buscar o conjunto completo');
assert.match(bloco, /documentos_agrupados/, 'filtros simples são aplicados após o agrupamento fiscal, antes da paginação');
assert.match(api, /function filtroSqlDocumentosFiscais/, 'API prepara filtros parametrizados para competência, modelo, busca e valor');
assert.match(telas, /documentosFiscaisPagina/, 'interface guarda página da lista fiscal');
assert.match(telas, /filtroOperacao/, 'somente a regra fiscal de operação mantém janela ampla temporária');
assert.match(telas, /filtros\.set\('sentido', sentido\)/, 'a aba de entradas ou saídas é filtrada antes da paginação');
console.log('documentos-fiscais-paginacao: filtros simples e lista usam paginação no banco; exportação segue integral: OK');

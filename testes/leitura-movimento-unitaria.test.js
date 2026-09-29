const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const telas = fs.readFileSync(require.resolve('../public/js/telas'), 'utf8');
const rota = api.slice(api.indexOf("router.get('/empresas/:id/movimentos/:movimentoId'"), api.indexOf("router.put('/empresas/:id/movimentos/:movimentoId/classificacao'"));
const modal = telas.slice(telas.indexOf("[data-abrir-pendencia]"), telas.indexOf("document.getElementById('centralXmlSped')"));

assert.match(rota, /FROM movimentos WHERE empresa_id=\? AND id=\?/, 'rota lê somente o movimento da empresa e da pendência solicitada');
assert.match(rota, /await garantirEmpresaPermitida/, 'leitura unitária mantém a autorização da empresa');
assert.match(modal, /movimentos\/\$\{encodeURIComponent\(pendencia\.movimento_id\)\}/, 'modal pede somente o lançamento selecionado');
assert.doesNotMatch(modal, /limite=5000/, 'modal não transfere milhares de movimentos para abrir uma pendência');
console.log('leitura-movimento-unitaria: modal de pendência usa leitura por ID: OK');

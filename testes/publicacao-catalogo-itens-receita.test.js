const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-publicacao-catalogo-'));
const { chaveConflitoPublicacao } = require('../src/services/operacaoCompartilhada');

assert.equal(chaveConflitoPublicacao('catalogo_itens_receita'), 'chave');
assert.equal(chaveConflitoPublicacao('movimentos'), 'id');

console.log('Publicação compartilhada: catálogo de itens usa chave como conflito.');
require('../src/db').close();
fs.rmSync(process.env.SATTVA_DADOS, { recursive:true, force:true });

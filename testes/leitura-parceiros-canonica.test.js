const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leitor = fs.readFileSync(path.join(raiz, 'src/services/parceirosCompartilhados.js'), 'utf8');
const rota = fs.readFileSync(path.join(raiz, 'src/routes/api.js'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'public/js/telas.js'), 'utf8');

assert.match(leitor, /BEGIN READ ONLY/, 'leitura oficial de fornecedores deve ser somente leitura');
assert.match(leitor, /duplicidades_tecnicas_ocultas/, 'projeção canônica deve informar cópias técnicas ocultas');
assert.match(rota, /parceirosCompartilhados.*listar/, 'rota de parceiros deve poder usar a fonte canônica');
assert.match(tela, /leitura=canonica/, 'lista de fornecedores deve requisitar a leitura canônica');
assert.match(tela, /Cadastro oficial · fonte canônica/, 'a interface deve revelar a origem da lista');
console.log('OK leitura-parceiros-canonica');

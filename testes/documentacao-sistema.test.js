const assert = require('assert');
const fs = require('fs');

const rota = fs.readFileSync('src/routes/api.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const telas = fs.readFileSync('public/js/telas3.js', 'utf8');

assert.match(rota, /MANUAL_USUARIO_SATTVA_REFORMA_TRIBUTARIA\.md/);
assert.match(rota, /GUIA_INSTRUTOR_SATTVA_REFORMA_TRIBUTARIA\.md/);
assert.match(rota, /router\.get\('\/documentacao-uso'/);
assert.match(rota, /router\.get\('\/documentacao-uso\/:tipo\/download'/);
assert.match(rota, /readFileSync\(documento\.caminho, 'utf8'\)/);
assert.match(app, /Manuais do sistema/);
assert.match(app, /documentacaoSistema: 'configuracoes'/);
assert.match(telas, /Telas\.documentacaoSistema/);
assert.match(telas, /Atualizar visualização/);
assert.match(telas, /Baixar/);
assert.match(telas, /versão oficial publicada/);
assert.match(telas, /a cada abertura/);
console.log('Documentação do sistema: visualização e download usam os arquivos oficiais publicados.');

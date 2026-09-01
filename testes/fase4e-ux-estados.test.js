const assert = require('assert');
const fs = require('fs');

const rota = fs.readFileSync('src/routes/api.js', 'utf8');
const tela = fs.readFileSync('public/js/telas.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');

assert.match(rota, /dados_operacionais_pendentes_sincronizacao/);
assert.match(rota, /operacaoCompartilhada'\)\.baixar\(\)/);
assert.match(tela, /Dados operacionais aguardando sincronização/);
assert.match(tela, /não representam ausência de dados fiscais/);
assert.match(app, /Central de Dados/);
assert.match(tela, /DADOS · ENTRADA E TRATAMENTO/);
assert.match(tela, /Ir para Central de Dados/);
console.log('Fase 4E: cache pendente é explícito e a Central de Dados concentra a entrada operacional.');

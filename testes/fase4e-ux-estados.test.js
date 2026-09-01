const assert = require('assert');
const fs = require('fs');

const rota = fs.readFileSync('src/routes/api.js', 'utf8');
const tela = fs.readFileSync('public/js/telas.js', 'utf8');

assert.match(rota, /dados_operacionais_pendentes_sincronizacao/);
assert.match(rota, /operacaoCompartilhada'\)\.baixar\(\)/);
assert.match(tela, /Dados operacionais aguardando sincronização/);
assert.match(tela, /não representam ausência de dados fiscais/);
console.log('Fase 4E: painel não apresenta cache operacional incompleto como ausência de dados.');

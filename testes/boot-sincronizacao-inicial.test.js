const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');

assert.match(app, /metodo === 'GET' && r\.status === 503 && j\.codigo === 'BASE_OPERACIONAL_INDISPONIVEL'/,
  'somente a indisponibilidade transitória de leitura deve ser repetida');
assert.match(app, /tentativa < 24/, 'a espera automática deve ser limitada');
assert.match(app, /não repetir uma ação que possa alterar dados/i, 'escritas não podem receber repetição automática');
assert.match(app, /Preparando a base operacional/, 'a mensagem residual não deve acusar servidor indisponível');

console.log('boot-sincronizacao-inicial: retry limitado de leitura validado.');

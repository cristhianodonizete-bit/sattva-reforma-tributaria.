const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const api = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8'); const tela = fs.readFileSync(path.join(__dirname, '../public/js/telas5.js'), 'utf8');
assert.match(api, /motor\/status/); assert.match(api, /duracao_ms/); assert.match(tela, /motor\/status/); assert.match(tela, /setTimeout\(acompanhar, 2000\)/); assert.match(tela, /fotografia anterior permanece vigente/);
console.log('motor-acompanhamento: status e polling seguro validados.');

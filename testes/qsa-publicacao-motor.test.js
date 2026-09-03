const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
const motor = fs.readFileSync(path.join(__dirname, '../src/services/motorExec.js'), 'utf8');

assert.match(api, /async function reprocessarSaidasPorQsa/, 'QSA deve poder aguardar a publicação');
assert.match(api, /movimentoIds: saidas, ano: 2027, publicarAssincrona: false/, 'reprocessamento QSA não pode publicar em segundo plano');
assert.match(api, /await require\('\.\.\/services\/operacaoCompartilhada'\)\.publicarResultadosMotor\(empresaId\)/, 'QSA deve aguardar a fotografia compartilhada');
assert.match(api, /motorExec\.executar\(req\.params\.id, \{ ano: req\.body\.ano, anexoSimples: req\.body\.anexo, publicarAssincrona: false \}\)/, 'execução manual deve aguardar a publicação');
assert.match(motor, /publicarAssincrona: opcoes\.publicarAssincrona !== false/, 'motor deve permitir fluxo síncrono');

console.log('QSA/motor: publicação durável antes da confirmação validada.');

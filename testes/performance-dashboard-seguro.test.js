const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');

assert.match(api, /const DASHBOARD_CACHE_MS = 5000;/, 'cache do dashboard deve ser curto');
assert.match(api, /req\.usuario\?\.id/, 'cache deve ser separado por usuário');
assert.match(api, /!\['GET', 'HEAD', 'OPTIONS'\]\.includes\(req\.method\).*invalidarDashboardCache/s, 'escritas bem-sucedidas devem invalidar o dashboard');
assert.match(api, /Cache-Control', 'private, no-store'/, 'navegador e proxy não podem reutilizar a resposta');
assert.match(app, /Promise\.all\(\[carregarParametros\(\), carregarEmpresas\(\)\]\)/, 'leituras iniciais independentes devem ocorrer em paralelo');

console.log('Performance dashboard segura: cache isolado, invalidação e carga paralela validados.');

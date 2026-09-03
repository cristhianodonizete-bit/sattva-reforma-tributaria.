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
assert.match(api, /const CACHE_BASES_MS = 30000;/, 'catálogos devem ter cache curto e limitado');
assert.match(api, /const chave = req\.originalUrl;/, 'cache de bases deve isolar cada consulta e página');
assert.match(api, /invalidarCacheBases\(\);/, 'toda escrita bem-sucedida deve invalidar o catálogo');
assert.match(api, /router\.get\('\/bases\/catalogo',[\s\S]*?responderBasesEmCache/, 'catálogo paginado deve reutilizar apenas leitura recente');
assert.doesNotMatch(api, /router\.get\('\/empresas\/[^\n]*responderBasesEmCache/, 'cache de bases não pode englobar dados de empresa');

console.log('Performance segura: cache isolado, invalidação e carga paralela validados.');

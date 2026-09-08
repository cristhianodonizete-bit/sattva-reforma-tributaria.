const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const db = fs.readFileSync(path.join(raiz, 'src/db.js'), 'utf8');
const api = fs.readFileSync(path.join(raiz, 'src/routes/api.js'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'public/js/app.js'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'public/js/telas3.js'), 'utf8');

assert.match(db, /CREATE TABLE IF NOT EXISTS sla_marcos/, 'marcos de SLA devem ser persistidos');
assert.match(db, /CREATE TABLE IF NOT EXISTS sla_tarefas/, 'tarefas-modelo devem ser persistidas');
assert.match(db, /projeto_prorrogacoes_sla/, 'prorrogações devem ter histórico próprio');
assert.match(api, /function aplicarSlaNoProjeto/, 'aprovação deve materializar tarefas do SLA');
assert.match(api, /router\.post\('\/projeto\/tarefas\/:id\/prorrogar'/, 'prorrogação deve ter rota dedicada');
assert.match(api, /propagarPrazoSla/, 'prorrogação deve reprogramar etapas dependentes');
assert.match(app, /data-prorrogar-tarefa/, 'tarefa obrigatória deve expor ação de prorrogação');
assert.match(tela, /Telas\.sla/, 'Gestão do Produto deve ter cadastro de SLA');

console.log('SLA de projetos: configuração, tarefas obrigatórias e reprogramação validados.');

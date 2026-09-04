const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
const motor = fs.readFileSync(path.join(__dirname, '../src/services/motorExec.js'), 'utf8');
const operacao = fs.readFileSync(path.join(__dirname, '../src/services/operacaoCompartilhada.js'), 'utf8');

assert.match(api, /async function reprocessarSaidasPorQsa/, 'QSA deve poder aguardar a publicação');
assert.match(api, /movimentoIds: saidas, ano: 2027, publicarAssincrona: false/, 'reprocessamento QSA não pode publicar em segundo plano');
assert.match(api, /await require\('\.\.\/services\/operacaoCompartilhada'\)\.publicarResultadosMotor\(empresaId\)/, 'QSA deve aguardar a fotografia compartilhada');
assert.match(api, /motorExecucaoFila\.solicitar\(Number\(req\.params\.id\), req\.body \|\| \{\}\)/, 'rota manual deve criar job assíncrono');
assert.match(motor, /publicarAssincrona: opcoes\.publicarAssincrona !== false/, 'motor deve manter publicação controlável pelo worker');
assert.match(motor, /publicarAssincrona: opcoes\.publicarAssincrona !== false/, 'motor deve permitir fluxo síncrono');
assert.match(operacao, /origem=CASE WHEN empresa_qsa\.origem='confirmacao_manual' THEN empresa_qsa\.origem ELSE excluded\.origem END/, 'UPSERT de QSA deve fechar a cláusula CASE e preservar confirmação manual');

console.log('QSA/motor: publicação durável antes da confirmação validada.');

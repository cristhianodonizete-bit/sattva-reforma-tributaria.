const assert=require('node:assert/strict');
const fs=require('node:fs');

const api=fs.readFileSync(require.resolve('../src/routes/api'),'utf8');
const tela=fs.readFileSync(require.resolve('../public/js/telas.js'),'utf8');
const inicio=api.indexOf("router.post('/empresas/:id/regimes/auditoria-vigencia/reprocessar'");
const fim=api.indexOf('// Validação humana de benefício fiscal',inicio);
const rota=api.slice(inicio,fim);

assert.match(rota,/motorExecucaoFila\.solicitarIncremental/, 'a correção da auditoria precisa ir para a fila durável');
assert.doesNotMatch(rota,/motorExec\.reprocessarIncremental/, 'o cache local não pode encerrar a correção de auditoria');
assert.match(tela,/retorno\.processamento_motor\?\.job\?\.id/, 'a tela precisa aguardar o job que publicou a fotografia');
console.log('auditoria-regime-publicacao: auditoria usa fotografia publicada no Supabase: OK');

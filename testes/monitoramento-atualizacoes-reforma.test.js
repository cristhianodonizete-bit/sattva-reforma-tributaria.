const assert = require('assert');
const monitor = require('../src/services/monitoramentoAtualizacoesReforma');

assert.equal(monitor.FONTES.length, 9);
for (const fonte of monitor.FONTES) assert.equal(monitor.fontePermitida(fonte.url), true, fonte.nome);
assert.equal(monitor.fontePermitida('https://exemplo.com/nao-permitido'), false);
assert.match(monitor.textoLimpo('<script>ignorar()</script><h1> Norma </h1> &nbsp; vigente'), /Norma vigente/);
console.log('monitoramento-atualizacoes-reforma: fontes oficiais e proteção de domínio aprovadas.');

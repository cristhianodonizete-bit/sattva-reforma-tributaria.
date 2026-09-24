const assert = require('node:assert/strict');
const fs = require('node:fs');

const fonte = fs.readFileSync(require.resolve('../src/services/operacaoCompartilhada'), 'utf8');
const inicio = fonte.indexOf('async function baixarResultadosMotor');
const fim = fonte.indexOf('async function publicarResultadosMotor', inicio);
const bloco = fonte.slice(inicio, fim);

assert.match(bloco, /eq\('ativo', true\)/, 'somente a fotografia ativa é baixada');
assert.match(bloco, /\.in\('id', execucaoIds\.slice/, 'execuções são limitadas às referenciadas pela fotografia ativa');
assert.doesNotMatch(bloco, /buscarTudo\(remoto, 'motor_execucoes_operacionais'\)/, 'histórico completo não é trazido no boot');
console.log('fotografia-motor-enxuta: boot restaura apenas execução ativa: OK');

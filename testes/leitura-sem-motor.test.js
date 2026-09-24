const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const inicio = api.indexOf('function atualizarDiagnosticoSeAberto');
const fim = api.indexOf('// Fechamento é um marco', inicio);
const bloco = api.slice(inicio, fim);

assert.match(bloco, /motorExec\.pendentesIncrementais/, 'a leitura pode informar pendências sem calcular');
assert.doesNotMatch(bloco, /motorExec\.reprocessarIncremental/, 'a leitura não pode disparar motor');
console.log('leitura-sem-motor: telas consultam fotografia sem executar motor: OK');

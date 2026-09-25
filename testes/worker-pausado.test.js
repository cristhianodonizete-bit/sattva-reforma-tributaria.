const assert = require('node:assert/strict');
const fs = require('node:fs');
const fonte = fs.readFileSync(require.resolve('../worker'), 'utf8');
assert.match(fonte, /WORKER_ATIVO/, 'worker exige ativação explícita');
assert.match(fonte, /if \(!ativo\) return/, 'worker pausado não consome fila');
assert.match(fonte, /fila\.executar/, 'worker ativo usa a fila durável existente');
assert.doesNotMatch(fonte, /sincronizarIncremental/, 'worker não pode baixar a carteira inteira antes de consumir a fila');
assert.match(fonte, /worker fonte compartilhada:/, 'worker informa apenas o estado seguro da configuração');
console.log('worker-pausado: serviço nasce sem processar dados: OK');

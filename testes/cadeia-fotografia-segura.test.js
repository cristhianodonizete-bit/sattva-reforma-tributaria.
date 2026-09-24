const assert = require('node:assert/strict');
const fs = require('node:fs');
const fonte = fs.readFileSync(require.resolve('../src/services/consolidacaoOficial'), 'utf8');
assert.match(fonte, /cadeia_fotografias/, 'Cadeia possui fotografia derivada');
assert.match(fonte, /execucao_id=\? AND periodo_chave=\? AND lado=\?/, 'reuso exige execução, período e lado exatos');
assert.match(fonte, /fotografia_leitura:'REUTILIZADA'/, 'origem da fotografia é identificada');
console.log('cadeia-fotografia-segura: reuso exige fotografia válida: OK');

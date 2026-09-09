const assert = require('assert');
const fs = require('fs');
const fonte = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');

assert.match(fonte, /const criados = \[\]; const competenciasEncontradas = \[\]; const semRetorno = \[\];/);
assert.match(fonte, /competencias_encontradas: competenciasEncontradas/);
assert.match(fonte, /encontradas: competenciasEncontradas/);
assert.doesNotMatch(fonte, /\bdepois: \{ competencias, encontradas,/);
console.log('Baixa PGDAS: retorno e auditoria usam a coleção declarada de competências.');

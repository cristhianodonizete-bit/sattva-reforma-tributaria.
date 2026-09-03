const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('public/js/app.js', 'utf8');
const telas = ['public/js/telas.js', 'public/js/telas2.js', 'public/js/telas4.js', 'public/js/telas7.js']
  .map((arquivo) => fs.readFileSync(arquivo, 'utf8')).join('\n');

assert.match(app, /async function baixarArquivo/);
assert.match(app, /Authorization: `Bearer \$\{token\}`/);
assert.match(app, /URL\.createObjectURL/);
assert.match(telas, /App\.baixarArquivo\('\/modelos\/folha'/);
assert.match(telas, /App\.baixarArquivo\('\/modelos\/parceiros'/);
assert.match(telas, /App\.baixarArquivo\('\/modelos\/movimento_/);
assert.match(telas, /App\.baixarArquivo\('\/modelos\/receitas_sem_dfe'/);
assert.match(telas, /App\.baixarArquivo\(\\?'\/modelos\/pgdas/);
assert.doesNotMatch(telas, /window\.open\(['"]\/api\/(?:modelos|bases\/modelo)/);

console.log('download-modelos-autenticado: modelos usam a sessão ativa: OK');

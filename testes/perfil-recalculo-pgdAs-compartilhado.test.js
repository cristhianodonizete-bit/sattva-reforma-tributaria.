const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tela = fs.readFileSync(path.resolve(__dirname, '../public/js/telas.js'), 'utf8');

// O resumo recalculado do Simples não pode depender de uma fotografia local
// de histórico: em produção, o PGDAS confirmado é a evidência da cobertura
// mensal, inclusive para empresas que só possuem a fonte compartilhada.
assert.match(tela, /const competenciasPgdasConfirmadas = new Set\(\(diagnosticoPgdas\.confirmadas \|\| \[\]\)/);
assert.match(tela, /const competenciasDoExercicio = competenciasPgdasConfirmadas\.size/);
assert.match(tela, /recalculosCompetencia\.size === competenciasDoExercicio\.size/);
assert.doesNotMatch(tela, /const competenciasDoExercicio = new Set\(historico\.map/);

console.log('Perfil: recálculo por competência usa cobertura PGDAS compartilhada.');

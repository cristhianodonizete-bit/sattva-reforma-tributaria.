const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const op = fs.readFileSync(path.join(__dirname, '../src/services/operacaoCompartilhada.js'), 'utf8'); const fila = fs.readFileSync(path.join(__dirname, '../src/services/processamentoCarteira.js'), 'utf8');
assert.match(op, /async function validarFotografiaAtivaMotor/);
assert.match(op, /linhas\.length !== Number\(quantidadeEsperada\)/);
assert.match(fila, /await operacao\.validarFotografiaAtivaMotor\(job\.empresa_id, execucao\.id, quantidade\)/);
console.log('motor-promocao-confirmada: job exige confirmação remota antes de concluir.');

const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const fila = fs.readFileSync(path.join(__dirname, '../src/services/processamentoCarteira.js'), 'utf8');
const motor = fs.readFileSync(path.join(__dirname, '../src/services/motorExecucaoFila.js'), 'utf8');
assert.match(motor, /const TIPO = 'MOTOR_COMPLETO'/);
assert.match(motor, /iniciarWorker: false/);
assert.match(fila, /payload: JSON\.stringify\(opcoes\.payload/);
assert.match(fila, /if \(opcoes\.iniciarWorker !== false\)/);
console.log('motor-fila-contrato: job deduplicado e sem worker prematuro: OK');

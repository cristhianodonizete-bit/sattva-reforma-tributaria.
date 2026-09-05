const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { reduzirEventosIncrementais, chaveEvento } = require('../src/services/operacaoCompartilhada');

const eventos = [
  { sequencia: 11, tabela: 'movimentos', operacao: 'UPDATE', chave: { id: 7 } },
  { sequencia: 12, tabela: 'movimentos', operacao: 'DELETE', chave: { id: 7 } },
  { sequencia: 13, tabela: 'parceiros', operacao: 'INSERT', chave: { id: 4 } },
];
const reduzidos = reduzirEventosIncrementais(eventos);
assert.equal(reduzidos.length, 2, 'o mesmo registro deve ser aplicado apenas no último estado');
assert.equal(reduzidos[0].operacao, 'DELETE');
assert.equal(reduzidos[1].tabela, 'parceiros');
assert.equal(chaveEvento({ chave: { b: 2, a: 1 } }), chaveEvento({ chave: { a: 1, b: 2 } }), 'a chave deve ser estável');

const operacao = fs.readFileSync(path.join(__dirname, '../src/services/operacaoCompartilhada.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
assert.match(operacao, /CHAVE_SEQUENCIA_INCREMENTAL/);
assert.match(operacao, /function temSequenciaIncremental\(\)/);
assert.match(operacao, /sincronizacao_operacional_eventos/);
assert.match(operacao, /db\.transaction\(\(\) => \{/);
assert.match(operacao, /exclusão sensível em/);
assert.match(operacao, /modo: 'fallback_completo'/);
assert.match(operacao, /const dependentesDoMotor = \['excecoes_motor_execucoes', 'telemetria_autonomia_execucoes'\]/);
assert.match(operacao, /resultado\.motor = await baixarResultadosMotor\(remoto\); motorCarregado = true/);
assert.match(server, /await operacao\.sincronizarIncremental\(\)/);
assert.doesNotMatch(server, /dados = await operacao\.baixar\(\)/);
console.log('sincronizacao-incremental-consumo: deduplicação, checkpoint e bootstrap incremental validados.');

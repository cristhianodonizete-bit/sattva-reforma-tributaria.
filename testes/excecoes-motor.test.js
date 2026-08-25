#!/usr/bin/env node
const assert = require('node:assert/strict');
const db = require('../src/db');
const motorExec = require('../src/services/motorExec');
const excecoes = require('../src/services/excecoesMotor');

const empresa = db.prepare('SELECT id FROM empresas ORDER BY id LIMIT 1').get();
if (!empresa) throw new Error('Fixture ausente: é necessária uma empresa para a central de exceções.');

motorExec.executar(empresa.id, { ano: 2027 });
const resumo = excecoes.resumo(empresa.id);
const lista = excecoes.listar(empresa.id, { limite: 1000 });

assert.equal(resumo.abertas, lista.length, 'Resumo e lista de exceções abertas devem reconciliar');
assert.ok(lista.every((x) => Number(x.materialidade) >= 0), 'Exceções devem conter materialidade não negativa');
assert.ok(lista.every((x) => x.status === 'ABERTA'), 'A central padrão deve exibir somente exceções abertas');
for (let i = 1; i < lista.length; i++) {
  assert.ok(Number(lista[i - 1].materialidade) >= Number(lista[i].materialidade), 'Exceções devem ser ordenadas por materialidade');
}
console.log(`excecoes-motor.test: ${resumo.abertas} exceção(ões) abertas, priorizadas automaticamente.`);

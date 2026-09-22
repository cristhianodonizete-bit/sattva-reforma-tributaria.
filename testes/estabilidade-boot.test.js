#!/usr/bin/env node
/* O boot não pode calcular empresas nem consumir a fila pesada. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const inicio = servidor.indexOf('async function iniciarOperacao()');
const fim = servidor.indexOf('\nfunction iniciar()', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'bloco de inicialização encontrado');
const boot = servidor.slice(inicio, fim);
assert.doesNotMatch(boot, /motorExec\.executar\(/, 'boot não executa motor');
assert.doesNotMatch(boot, /bases\.classificarMovimentos\(/, 'boot não reclassifica movimentos');
assert.doesNotMatch(boot, /fila\.executar\(/, 'boot não consome fila');
assert.match(boot, /recuperarAbandonados\(/, 'boot preserva a recuperação segura de status da fila');
console.log('estabilidade-boot: inicialização sem cálculo ou fila pesada: OK');

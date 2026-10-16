'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8').replace(/\r\n/g, '\n');
const trecho = (texto, inicio, fim) => texto.slice(texto.indexOf(inicio), texto.indexOf(fim));
const depois = (texto, antes, alvo, mensagem) => assert.ok(texto.indexOf(alvo) > texto.indexOf(antes), mensagem);

const server = ler('server.js');
const boot = trecho(server, 'async function iniciarOperacao()', 'function iniciar()');
assert.ok(boot.includes("if (!escritasAutomaticasPermitidas())"), 'boot deve começar com a guarda de escrita automática');
for (const chamada of [
  "rpc('limpar_eventos_sincronizacao_operacional')",
  'agendarPendencias()',
  'fila.recuperarAbandonados()',
  'operacao.sincronizarIncremental(',
]) depois(boot, "if (!escritasAutomaticasPermitidas())", chamada, `boot não pode alcançar ${chamada} antes da guarda`);
assert.ok(server.includes("if (escritasAutomaticasPermitidas() && outboxEntradas.ativa())"), 'outbox deve exigir a flag');
assert.ok(server.includes('setInterval(sincronizarReferenciasFiscais, 24 * 60 * 60 * 1000)'), 'referência diária deve usar o wrapper protegido');
assert.ok(server.includes(`if (!escritasAutomaticasPermitidas()) {
      suprimirEscritaAutomatica('agendamento:telemetria')`), 'telemetria deve ser suprimida');
assert.ok(server.includes(`if (!escritasAutomaticasPermitidas()) {
      suprimirEscritaAutomatica('agendamento:monitoramento-normativo')`), 'monitoramento deve ser suprimido');

const worker = ler('worker.js');
assert.ok(worker.includes("const escritasAutomaticasPermitidas = String(process.env.ESCRITAS_AUTOMATICAS_PERMITIDAS || '').toLowerCase() === 'true';"), 'worker deve usar a mesma flag');
const ciclo = trecho(worker, 'async function ciclo()', 'async function registrarHeartbeat');
assert.ok(ciclo.includes('if (!consumidorAtivo) return;'), 'fila do worker deve ser bloqueada antes de carregar o consumidor');
const heartbeat = trecho(worker, 'async function registrarHeartbeat', 'async function iniciar');
assert.ok(heartbeat.includes('if (!escritasAutomaticasPermitidas)'), 'heartbeat deve ser bloqueado');
depois(heartbeat, 'if (!escritasAutomaticasPermitidas)', 'heartbeat.registrar(status, erro)', 'heartbeat remoto não pode ser chamado antes da guarda');

console.log('escritas-automaticas-bloqueio: guardas estruturais aprovadas sem iniciar web, worker ou motor');

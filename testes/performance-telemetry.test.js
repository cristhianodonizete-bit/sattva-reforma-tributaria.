const assert = require('node:assert/strict');
const telemetria = require('../src/services/performanceTelemetry');

telemetria.limparParaTeste();
assert.equal(telemetria.normalizarRota('/empresas/123/qsa/8'), '/empresas/:id/qsa/:id');
telemetria.registrar({ metodo: 'GET', rota: '/empresas/123/movimentos/99', status: 200, tempoMs: 120, memoria: { heapUsed: 10 * 1024 * 1024, rss: 20 * 1024 * 1024 } });
telemetria.registrar({ metodo: 'GET', rota: '/empresas/123/movimentos/100', status: 500, tempoMs: 1400, memoria: { heapUsed: 11 * 1024 * 1024, rss: 21 * 1024 * 1024 } });
const resumo = telemetria.resumo();
assert.equal(resumo.total_requisicoes, 2);
assert.equal(resumo.rotas.length, 1);
assert.equal(resumo.rotas[0].rota, 'GET /empresas/:id/movimentos/:id');
assert.equal(resumo.rotas[0].erros, 1);
assert.equal(resumo.rotas[0].lentas_acima_1s, 1);
assert.equal(resumo.rotas[0].p95_ms, 1400);
telemetria.limparParaTeste();

console.log('performance-telemetry: métricas agregadas e rotas sem identificadores: OK');

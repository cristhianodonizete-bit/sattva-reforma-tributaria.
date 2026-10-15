'use strict';
const assert=require('node:assert/strict');
const { resolverNaData, avaliarFotografia }=require('../src/services/regimeVigencia');

const cnpj='03773700004013';
const historico=[
  { cnpj,regime:'simples_nacional',versao:1,vigencia_inicio:'2024-01-01',vigencia_fim:'2025-12-31',fonte:'BrasilAPI' },
  { cnpj,regime:'imune_isento',versao:2,vigencia_inicio:'2026-01-01',vigencia_fim:null,fonte:'Base RFB 2024' },
];

// A troca posterior não reescreve a realidade fiscal de um documento antigo.
assert.equal(resolverNaData(historico,cnpj,'2025-07-10').regime,'simples_nacional');
assert.equal(resolverNaData(historico,cnpj,'2026-07-10').regime,'imune_isento');

// Uma fotografia antiga continua atual para documento no período antigo.
assert.equal(avaliarFotografia({ registros:historico,cnpj,dataDocumento:'2025-07-10',regimeFotografia:'simples_nacional',versaoFotografia:1 }).status,'ATUAL');
// Já um documento no período novo com fotografia antiga é divergente e só
// poderá ser reprocessado em etapa posterior, de forma incremental.
const divergente=avaliarFotografia({ registros:historico,cnpj,dataDocumento:'2026-07-10',regimeFotografia:'simples_nacional',versaoFotografia:1 });
assert.equal(divergente.status,'DIVERGENTE');
assert.equal(divergente.regime_vigente,'imune_isento');
assert.equal(divergente.reprocessar,true);
console.log('regime-vigencia-etapa1.test.js: OK');

const assert = require('assert');
const { filtrarOrfaosOperacionais } = require('../src/services/operacaoCompartilhada');

const empresas = new Set([1]);
const lotes = filtrarOrfaosOperacionais('lotes', [
  { id: 10, empresa_id: 1 }, { id: 11, empresa_id: 99 },
], empresas, new Set());
const lotesValidos = new Set(lotes.map((x) => x.id));
const parceiros = filtrarOrfaosOperacionais('parceiros', [
  { id: 1, empresa_id: 1 }, { id: 2, empresa_id: 99 },
], empresas, lotesValidos);
const movimentos = filtrarOrfaosOperacionais('movimentos', [
  { id: 1, empresa_id: 1, lote_id: 10 },
  { id: 2, empresa_id: 99, lote_id: 11 },
  { id: 3, empresa_id: 1, lote_id: 11 },
  { id: 4, empresa_id: 1, lote_id: null },
], empresas, lotesValidos);

assert.deepStrictEqual(lotes.map((x) => x.id), [10]);
assert.deepStrictEqual(parceiros.map((x) => x.id), [1]);
assert.deepStrictEqual(movimentos.map((x) => x.id), [1, 4]);
console.log('Fase 4E.1: órfãos remotos não bloqueiam a restauração nem cruzam empresas.');

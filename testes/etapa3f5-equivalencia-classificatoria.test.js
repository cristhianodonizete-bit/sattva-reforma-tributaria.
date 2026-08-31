const assert = require('assert');
const { avaliarEquivalenciaClassificatoria } = require('../src/services/equivalenciaClassificatoria');
const { avaliarDimensoes } = require('../src/services/autonomiaDimensoes');

const candidatosEquivalentes = [
  { nbs: '115012000', lc116: '0107', cclasstrib: '000001', catalogo_versao_id: 101, ind_gtrib_regular: 1, tipo_aliquota: 'PADRAO' },
  { nbs: '115012100', lc116: '0107', cclasstrib: '000001', catalogo_versao_id: 101, ind_gtrib_regular: 1, tipo_aliquota: 'PADRAO' },
];
const fatoOriginal = JSON.parse(JSON.stringify(candidatosEquivalentes));
const equivalente = avaliarEquivalenciaClassificatoria(candidatosEquivalentes, { tipo_operacao: 'tributada' });

assert.strictEqual(equivalente.status, 'EQUIVALENTE_FISCALMENTE');
assert.strictEqual(equivalente.impacto_tributario_material, false);
assert.strictEqual(equivalente.candidatos.length, 2);
assert.strictEqual(equivalente.candidatos[0].nbs, '115012000');
assert.strictEqual(equivalente.candidatos[1].nbs, '115012100');
assert.deepStrictEqual(candidatosEquivalentes, fatoOriginal, 'A avaliação não pode alterar o fato/documento original.');
assert.ok(equivalente.hash_decisao);

const dimensoes = avaliarDimensoes({
  sentido: 'entrada',
  base_economica: 100,
  cbs: 9.21,
  status_credito_determinacao: 'DETERMINADO',
  classificacao: { equivalenciaFiscal: equivalente },
});
assert.strictEqual(dimensoes.autonomia_classificatoria, 'PARCIAL');
assert.strictEqual(dimensoes.autonomia_diagnostico_completo, true);
assert.strictEqual(dimensoes.memoria.classificatoria.hash_decisao, equivalente.hash_decisao);

const divergente = avaliarEquivalenciaClassificatoria([
  candidatosEquivalentes[0],
  { nbs: '999999999', lc116: '0107', cclasstrib: '200001', catalogo_versao_id: 101, ind_gtrib_regular: 1, tipo_aliquota: 'PADRAO' },
]);
assert.strictEqual(divergente.status, 'DIVERGENTE_FISCALMENTE');
assert.strictEqual(divergente.impacto_tributario_material, true);

const indeterminada = avaliarEquivalenciaClassificatoria([
  candidatosEquivalentes[0],
  { nbs: '999999999', lc116: '0107' },
]);
assert.strictEqual(indeterminada.status, 'INDETERMINADA');
assert.strictEqual(indeterminada.impacto_tributario_material, null);

console.log('Etapa 3F.5 — equivalência classificatória: OK');

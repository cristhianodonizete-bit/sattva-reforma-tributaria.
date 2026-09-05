const assert = require('assert');
const { validar } = require('../scripts/gerar_validacao_juridica_76_diretas');
const resultado = validar({ id_proposto: 'R', ncm: '02011000', descricao: ['teste'], tratamento_resultante_proposto: 'ALÍQUOTA ZERO' });
assert.strictEqual(resultado.status_validacao_juridica, 'PRECISA_REVISAO_JURIDICA');
assert.strictEqual(resultado.impacto_lc224, 'INDETERMINADO');
assert.strictEqual(resultado.pis_cumulativo_desde_2026_04_01, null);
assert.ok(resultado.fontes.length >= 2);
console.log('gerar_validacao_juridica_76_diretas.test.js: PASSOU');

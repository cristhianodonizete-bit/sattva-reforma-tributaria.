const assert = require('node:assert/strict');
const motor = require('../src/services/motorPrecificacaoComercial');
const r = motor.calcular({ custo_liquido: 600, percentuais_por_dentro: .1, margem_contribuicao: .2, aliquota_efetiva_cbs: .09, modalidade:'REVENDA' });
assert.equal(r.status, 'CALCULATED'); assert.equal(r.preco_base, 857.14); assert.equal(r.cbs, 77.14); assert.equal(r.preco_final, 934.28); assert.equal(r.margem_valor, 171.43);
assert.equal(motor.calcular({ custo_liquido:100, percentuais_por_dentro:.8, margem_contribuicao:.2 }).status, 'INCOMPLETO');
assert.equal(motor.tratamentos({ custo_liquido:100, margem_contribuicao:.2 }, [{ tratamento:'ALIQ_ZERO', aliquota_efetiva_cbs:0, preserva_credito:true }])[0].cbs, 0);
console.log('motor-precificacao-comercial: markup, CBS por fora e bloqueio aprovados.');

const assert = require('node:assert/strict');
const { projetar } = require('../src/services/projecoesPrecificacaoCenarios');
const r=projetar({preco_atual:1000,custo_liquido:600,percentuais_por_dentro:.1,margem_contribuicao:.2,aliquota_efetiva_cbs:.09});
assert.equal(r.length,8); assert.equal(r.find(x=>x.chave==='B_SEM_ACAO').status,'CALCULATED');
assert.equal(r.find(x=>x.chave==='C_PRESERVAR_PRECO').resultado.preco_final,1000);
assert.equal(r.find(x=>x.chave==='H_SIMPLES').status,'REQUER_CONFIRMACAO');
console.log('projecoes-precificacao-cenarios: A–H derivados sem duplicar catálogo aprovados.');

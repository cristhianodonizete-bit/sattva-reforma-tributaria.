const assert = require('node:assert/strict');
const ponte = require('../src/services/precificacaoCenarios');

const completo = {
  saida: { movimento_id: 1, preco_atual: 100, base_economica: 92, cbs: 8, preco_projetado: 100 },
  formacao: { cobertura: 'COMPLETO', credito_cbs_precificavel: 12 },
  comercial: { margem_projetada: 30, margem_projetada_percentual: 0.3 },
};

const cenarios = ponte.aplicabilidadeDoItem(completo, { regimeEmpresa: 'simples_nacional' });
assert.equal(cenarios.length, 8, 'a Precificação deve consumir os oito templates A–H');
assert.equal(cenarios.find((x) => x.chave === 'B_SEM_ACAO').aplicavel, true);
assert.equal(cenarios.find((x) => x.chave === 'D_PRESERVAR_MARGEM').aplicavel, true);
assert.equal(cenarios.find((x) => x.chave === 'H_SIMPLES').aplicavel, true);
assert.equal(ponte.aplicabilidadeDoItem({ saida: completo.saida, formacao: { cobertura: 'INCOMPLETO' } }, { regimeEmpresa: 'lucro_real' }).find((x) => x.chave === 'D_PRESERVAR_MARGEM').aplicavel, false);
assert.deepEqual(ponte.impactosDoItem(completo), { preco_atual: 100, preco_base: 92, cbs: 8, preco_final: 100, margem_valor: 30, margem_percentual: 0.3, credito_cbs_precificavel: 12 });
console.log('precificacao-cenarios: catálogo A–H e aplicabilidade por item aprovados.');

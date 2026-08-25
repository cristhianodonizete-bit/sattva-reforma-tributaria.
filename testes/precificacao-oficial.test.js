const assert = require('assert');
const fs = require('fs');
const prec = require('../src/engine/precificacao');

assert.ok(!/require\(['"]\.\/calculadora['"]\)/.test(fs.readFileSync(require.resolve('../src/engine/precificacao'), 'utf8')), 'precificacao.js não pode depender de calculadora.js');

const saida = {
  movimento_id: 900, preco_atual: 1000, base_economica: 900,
  cbs: 83.25, ibs: 0, preco_projetado: 983.25,
  tratamento: 'TRIBUTACAO_INTEGRAL', cst: '000', cclasstrib: '000001', natureza: 'CALCULADO',
};
const item = { id: 1, descricao: 'Saída oficial', tipo: 'mercadoria', movimento_saida_id: 900 };
const formacao = (x = {}) => ({
  status_formacao_custo: 'COMPLETO', custo_economico_bruto_alocado: 700,
  credito_cbs_total: 100, credito_cbs_direto: 50, credito_cbs_rateado: 25,
  credito_cbs_nao_alocado: 25, credito_cbs_precificavel: 75, componentes: [], ...x,
});

// Revenda 1:1 e verdade única: nada fiscal é reconstruído na precificação.
let r = prec.analisarItemOficial({ item, saida, formacao: formacao(), despesasVariaveis: 0.05 });
assert.equal(r.status, 'COMPLETO');
assert.equal(r.saida.base_economica, saida.base_economica);
assert.equal(r.saida.cbs, saida.cbs);
assert.equal(r.saida.tratamento, saida.tratamento);
assert.equal(r.formacao.credito_cbs_total, r.formacao.credito_direto + r.formacao.credito_rateado + r.formacao.credito_nao_alocado);
assert.equal(r.formacao.custo_liquido, 625);

// Várias entradas para uma saída: crédito direto + rateado + não alocado.
r = prec.analisarItemOficial({ item, saida, formacao: formacao({ credito_cbs_total: 120, credito_cbs_direto: 50, credito_cbs_rateado: 30, credito_cbs_nao_alocado: 40, credito_cbs_precificavel: 80 }) });
assert.equal(r.status, 'COMPLETO');
assert.equal(r.formacao.credito_cbs_precificavel, 80);

// Uma entrada pode compor várias saídas: cada item recebe só seu rateio explícito.
r = prec.analisarItemOficial({ item: { ...item, id: 2 }, saida, formacao: formacao({ credito_cbs_total: 100, credito_cbs_direto: 0, credito_cbs_rateado: 40, credito_cbs_nao_alocado: 60, credito_cbs_precificavel: 40 }) });
assert.equal(r.status, 'COMPLETO');
assert.equal(r.formacao.custo_liquido, 660);

// Falta de vínculo nunca vira custo/margem zero.
r = prec.analisarItemOficial({ item: { ...item, movimento_saida_id: null }, saida: null, formacao: formacao() });
assert.equal(r.status, 'INCOMPLETO');
assert.equal(r.comercial, null);

// Formação incompleta e divergência bloqueiam resultado definitivo.
r = prec.analisarItemOficial({ item, saida, formacao: formacao({ status_formacao_custo: 'INCOMPLETO' }) });
assert.equal(r.status, 'INCOMPLETO');
r = prec.analisarItemOficial({ item, saida, formacao: formacao({ credito_cbs_nao_alocado: 20 }) });
assert.equal(r.status, 'DIVERGENTE');

console.log('Precificação oficial: 6 cenários aprovados.');

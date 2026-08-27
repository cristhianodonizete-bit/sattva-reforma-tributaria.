#!/usr/bin/env node
/* Etapa 5 — análise exclusivamente derivada de resultado já calculado. */
const assert = require('node:assert/strict');
const analise = require('../src/services/analiseCadeia');

const grupos = (dados) => ({ grupos: dados.map(([grupo, valor, extra = {}]) => ({ grupo, nome:grupo, valor, participacao:valor / 1000, baseEconomica:valor, custoEfetivo:valor, creditoIbs:0, creditoCbs:extra.credito || 0, ...extra })) });
const resultado = {
  indicadores:{ compras:1000, receita:1000, creditoRecebido:250, creditoEntregue:90, custoEfetivoCompras:850, margem:null },
  base:{ indicadores:{ custoEfetivoCompras:800 } }, indiceMudanca:{ compras:0.22, vendas:0.1 },
  efeitos:{ compras:{ efeitoCredito:40, precoProjetadoBase:1000, precoProjetadoCenario:1060, efeitoLiquido:10 } },
  composicao:{
    compras:{
      credito_fornecedor:grupos([['normal',400,{ credito:100 }],['simples',200,{ credito:50 }],['sem_credito',220],['indeterminado',180]]),
      regime_fornecedor:grupos([['regular',550],['simples',270],['mei',80],['indeterminado',100]]),
    },
    vendas:{
      perfil_cliente:grupos([['b2b_credito',450],['b2b_sem_credito',150],['b2c_pf',200],['b2c_pj',100],['governo',50],['indeterminado',50]]),
      sensibilidade_cliente:grupos([['alta',300],['media',150],['baixa',500],['indeterminado',50]]),
    },
  },
};

const r = analise.analisar(resultado);
assert.equal(r.indicadores.taxa_recuperacao_compras.percentual, 0.25);
assert.equal(r.indicadores.exposicao_simples.percentual, 0.27);
assert.equal(r.indicadores.exposicao_mei.percentual, 0.08);
assert.equal(r.indicadores.exposicao_credito_indeterminado.percentual, 0.18);
assert.equal(r.indicadores.cobertura_cadastral_clientes.percentual, 0.95);
assert.equal(r.indicadores.cobertura_cadastral_fornecedores.percentual, 0.9);
assert.equal(r.indicadores.delta_custo_efetivo.valor, 50);
assert.equal(r.indicadores.indice_mudanca_cadeia.compras, 0.22);
assert.ok(r.alertas.some((x) => x.id === 'credito_indeterminado'), 'indeterminado permanece alerta, não vira zero');
assert.ok(r.alertas.some((x) => x.id === 'simples'), 'alerta de Simples traz evidência');
assert.equal(r.matriz.linhas.length, 4);
assert.equal(r.matriz.linhas[0].celulas.length, 4);
assert.equal(r.matriz.linhas[3].celulas[3].drilldown.compras.grupos[0], 'indeterminado');
assert.equal(r.matriz.linhas[0].celulas[0].margem, null, 'margem sem custo completo permanece incompleta');
console.log('etapa5-analise-cadeia: indicadores, alertas explicáveis, matriz e indeterminado explícito aprovados.');

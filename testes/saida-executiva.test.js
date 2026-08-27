#!/usr/bin/env node
/* Saída executiva: consolida fatos, não cria segundo cálculo tributário. */
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const saida = require('../src/services/saidaExecutiva');

const grupos = (dados) => ({ grupos: dados.map(([grupo, valor, extra = {}]) => ({ grupo, nome:grupo, valor, participacao:valor / 1000, baseEconomica:valor, custoEfetivo:valor, creditoIbs:0, creditoCbs:extra.credito || 0, ...extra })) });
const resultado = {
  eBase:true, ano:2027, cenario:{ id:-29001, nome:'Base fixture executiva', tipo:'base' },
  entradas:[{ movimento_id:1 }], saidas:[{ movimento_id:2 }],
  indicadores:{ compras:1000, receita:1000, creditoRecebido:100, creditoEntregue:90, custoEfetivoCompras:900,
    receitaProjetada:1100, comprasProjetadas:1080, baseEconomicaSaidas:900, baseEconomicaEntradas:900,
    margem:null, coberturaMargem:0, caixaOperacional:null, statusCaixa:'INCOMPLETO' },
  apuracao:{ cbs:{ debitos:100, creditos:100, liquido:0 }, ibs:{ debitos:0, creditos:0, liquido:0 } },
  composicao:{
    compras:{ credito_fornecedor:grupos([['normal',500,{ credito:100 }],['simples',200],['sem_credito',100],['indeterminado',200]]), regime_fornecedor:grupos([['regular',600],['simples',200],['mei',0],['indeterminado',200]]) },
    vendas:{ perfil_cliente:grupos([['b2b_credito',500],['b2b_sem_credito',100],['b2c_pf',200],['b2c_pj',0],['governo',0],['indeterminado',200]]), sensibilidade_cliente:grupos([['alta',500],['media',0],['baixa',300],['indeterminado',200]]) },
  },
};

(async () => {
  const r = saida.montar([resultado]);
  assert.equal(r.base.cbsDebito, 100, 'CBS vem da apuração oficial do cenário');
  assert.equal(r.secoes.vendas.cbs, 100, 'venda não possui cálculo paralelo');
  assert.equal(r.secoes.compras.credito, 100, 'crédito é reutilizado do resultado oficial');
  assert.ok(r.secoes.limitacoes.some((x) => x.natureza === 'INDETERMINADO'), 'indeterminado permanece explícito');
  assert.ok(r.secoes.limitacoes.some((x) => x.natureza === 'INCOMPLETO'), 'margem/caixa incompletos não viram estimativa');
  assert.equal(r.secoes.premissas.length, 0, 'fixture não cria premissa inexistente');
  const stream = new PassThrough(); const partes = [];
  stream.on('data', (x) => partes.push(x));
  const terminou = new Promise((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject); });
  saida.gerarPdf(r, stream); await terminou;
  const pdf = Buffer.concat(partes).toString('latin1', 0, 8);
  assert.equal(pdf, '%PDF-1.3', 'exportação entrega PDF válido');
  console.log('saida-executiva: apresentação derivada, limitações explícitas e PDF aprovados.');
})().catch((e) => { console.error(e); process.exitCode = 1; });

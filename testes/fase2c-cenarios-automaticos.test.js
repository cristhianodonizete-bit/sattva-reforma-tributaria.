#!/usr/bin/env node
/* Fase 2C — templates A–H e estratégias comerciais sem segundo motor fiscal. */
const assert = require('node:assert/strict');
const db = require('../src/db');
const templates = require('../src/services/cenarioTemplates');
const cenarioMotor = require('../src/services/cenarioMotor');

const MARCA = 'FIXTURE_FASE2C_CENARIO';
const NCM = '99990003';
const empresa = { id: -20273, regime: 'regime_regular', razao_social: MARCA };

function instalar() {
  db.prepare('DELETE FROM base_ncm WHERE ncm=?').run(NCM);
  db.prepare(`INSERT INTO base_ncm (ncm,descricao,cst,cclasstrib,classificacao,reducao,fundamento,fonte,candidatos)
    VALUES (?,?,'000','000001','Tributação integral — fixture Fase 2C','integral',?,?,1)`)
    .run(NCM, 'Produto Fase 2C', MARCA, MARCA);
}
function limpar() { db.prepare('DELETE FROM base_ncm WHERE ncm=?').run(NCM); }
function item(id = 1) {
  return { movimento_id:id, cnpj:`fase2c-${id}`, valor:1000, precoAtual:1000, documento:MARCA,
    descricao:'Produto Fase 2C', ncm:NCM, cfop:'5102', pis:0, cofins:0, icms:0, iss:0,
    regimeAdquirente:null, fracao:1, grupos:{ perfil_cliente:'indeterminado', natureza_operacao:'mercadoria' } };
}

try {
  instalar();
  const todos = templates.listar();
  assert.equal(todos.length, 8, 'A–H devem existir');
  assert.deepEqual(todos.map((x) => x.codigo).join(''), 'ABCDEFGH');
  assert.equal(templates.obter('A_REFERENCIA').base, true);
  assert.equal(templates.obter('C_PRESERVAR_PRECO').premissas[0].campo, 'estrategia_preco');

  const original = item();
  const base = { empresa, ano:2027, brutos:new Map([[1, original]]), formacaoPorSaida:new Map() };
  const pC = [{ id:1,nivel:'global',lado:'vendas',campo:'estrategia_preco',valor_simulado:'PRESERVAR_PRECO_FINAL',natureza:'SIMULADO',fonte:'TESTE' }];
  const linhaBase = cenarioMotor.recalcular(base, 'vendas', [original], [] )[0];
  const linhaC = cenarioMotor.recalcular(base, 'vendas', [original], pC)[0];
  assert.ok(Math.abs(linhaC.precoProjetado - linhaBase.precoAtual) < 0.05,
    'C preserva preço final usando o motor oficial');
  assert.equal(linhaC.classificacao.status, linhaBase.classificacao.status, 'estratégia comercial não altera classificação');
  assert.equal(linhaC.cst, linhaBase.cst, 'estratégia comercial não altera CST');

  const baseComCusto = { ...base, formacaoPorSaida:new Map([[1, { status:'COMPLETO', custoLiquido:300, despesasVariaveis:0.1 }]]) };
  const pD = [{ id:2,nivel:'global',lado:'vendas',campo:'estrategia_preco',valor_simulado:'PRESERVAR_MARGEM',natureza:'SIMULADO',fonte:'TESTE' }];
  const linhaD = cenarioMotor.recalcular(baseComCusto, 'vendas', [original], pD)[0];
  const margemAtual = linhaBase.baseEconomica - 300 - linhaBase.precoAtual * 0.1;
  const margemD = linhaD.baseEconomica - 300 - linhaD.precoProjetado * 0.1;
  assert.ok(Math.abs(margemD - margemAtual) < 0.05, 'D preserva margem com custo explicitamente vinculado');
  assert.equal(linhaD.classificacao.status, linhaBase.classificacao.status, 'D não altera classificação fiscal');

  const r = cenarioMotor.calcularIndicadores([], [linhaC], { apuracao:{ cargaLiquida:linhaC.cbs + linhaC.ibs }, formacaoPorSaida:new Map() });
  assert.equal(r.margem, null, 'sem formação de custo margem não é inventada');
  assert.equal(r.caixaOperacional, null, 'sem formação de custo caixa não é inventado');
  console.log('fase2c-cenarios-automaticos: templates A–H, preservação de preço pelo motor e indicadores sem inferência aprovados.');
} finally { limpar(); }

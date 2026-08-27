#!/usr/bin/env node
/* Fase 2B — precedência e expansão de premissas, sem carteira real. */
const assert = require('node:assert/strict');
const db = require('../src/db');
const cenarioMotor = require('../src/services/cenarioMotor');

const MARCA = 'FIXTURE_FASE2B_PREMISSA_2027';
const NCM = '99990002';
const NBS = '999900002';
const empresa = { id: -20271, regime: 'regime_regular', razao_social: MARCA };
const baseItem = { valor: 1000, documento: MARCA, cfop: '5102', pis: 0, cofins: 0, icms: 0, iss: 0 };
let id = 0;
const premissa = (nivel, campo, valor, extra = {}) => ({ id: ++id, nivel, campo, valor_simulado: String(valor),
  lado: 'vendas', natureza: 'SIMULADO', fonte: 'TESTE_ISOLADO', ...extra });

function instalar() {
  db.prepare('DELETE FROM base_ncm WHERE ncm=?').run(NCM);
  db.prepare('DELETE FROM base_servicos WHERE nbs=?').run(NBS);
  db.prepare(`INSERT INTO base_ncm (ncm,descricao,cst,cclasstrib,classificacao,reducao,fundamento,fonte,candidatos)
    VALUES (?,?,'000','000001','Tributação integral — fixture Fase 2B','integral',?,?,1)`)
    .run(NCM, 'Produto Fase 2B', MARCA, MARCA);
  db.prepare(`INSERT INTO base_servicos (lc116,nbs,descricao_item,descricao_nbs,cclasstrib,nome_cclasstrib,reducao,tratamento_pis_cofins,regra_precedencia)
    VALUES ('1.01',?,?,?,'000001','Tributação integral — fixture Fase 2B','integral','REGRA_GERAL',?)`)
    .run(NBS, 'Serviço Fase 2B', 'Serviço Fase 2B', MARCA);
}
function limpar() {
  db.prepare('DELETE FROM base_ncm WHERE ncm=?').run(NCM);
  db.prepare('DELETE FROM base_servicos WHERE nbs=?').run(NBS);
}
function item(tipo, movimentoId, codigo = null) {
  const produto = tipo === 'produto';
  return {
    ...baseItem, movimento_id: movimentoId, cnpj: `fixture-${movimentoId}`,
    ncm: produto ? (codigo === null ? NCM : codigo) : '',
    nbs: produto ? '' : (codigo === null ? NBS : codigo),
    cst: produto ? '' : '1.01', descricao: `${tipo} ${movimentoId}`,
    regimeAdquirente: null, precoAtual: 1000,
    grupos: { perfil_cliente: 'indeterminado', natureza_operacao: produto ? 'mercadoria' : 'servico' },
  };
}
function rodar(itens, premissas = [], alocacoes = []) {
  const exp = cenarioMotor.expandir(itens, 'vendas', alocacoes, premissas);
  const brutos = new Map(itens.map((x) => [x.movimento_id, x]));
  return { exp, linhas: cenarioMotor.recalcular({ empresa, ano: 2027, brutos }, 'vendas', exp.itens, premissas) };
}

try {
  instalar();

  // 1–4. Precedência determinística e objeto de resolução completo.
  const p = item('produto', 1);
  let r = cenarioMotor.resolverPremissas(p, 'vendas', [premissa('global', 'variacao_preco', 0.10)], { variacao_preco: 0 });
  assert.equal(r.ctx.variacao_preco, 0.10); assert.equal(r.resolucao.variacao_preco.nivel_precedencia_aplicado, 'global');
  r = cenarioMotor.resolverPremissas(p, 'vendas', [premissa('global', 'variacao_preco', 0.10), premissa('grupo', 'variacao_preco', 0.20, { dimensao:'perfil_cliente', grupo:'indeterminado' })], { variacao_preco: 0 });
  assert.equal(r.ctx.variacao_preco, 0.20); assert.equal(r.resolucao.variacao_preco.nivel_precedencia_aplicado, 'grupo');
  r = cenarioMotor.resolverPremissas(p, 'vendas', [premissa('global', 'variacao_preco', 0.10), premissa('grupo', 'variacao_preco', 0.20, { dimensao:'perfil_cliente', grupo:'indeterminado' }), premissa('individual', 'variacao_preco', 0.30, { entidade_tipo:'movimento', entidade_id:'1' })], { variacao_preco: 0 });
  assert.equal(r.ctx.variacao_preco, 0.30); assert.equal(r.resolucao.variacao_preco.nivel_precedencia_aplicado, 'individual');
  assert.equal(r.resolucao.variacao_preco.premissa_global.valor, 0.10);
  assert.equal(r.resolucao.variacao_preco.premissa_grupo.valor, 0.20);
  assert.equal(r.resolucao.variacao_preco.premissa_individual.valor, 0.30);

  // 5. Campos independentes coexistem: preço individual e regime global.
  const combinadas = [
    premissa('global', 'regime', 'regime_regular'),
    premissa('global', 'variacao_preco', 0.05),
    premissa('grupo', 'variacao_preco', 0.10, { dimensao:'perfil_cliente', grupo:'indeterminado' }),
    premissa('individual', 'variacao_preco', 0.15, { entidade_tipo:'movimento', entidade_id:'1' }),
  ];
  const combinado = rodar([p], combinadas);
  assert.equal(combinado.linhas[0].resolucaoPremissas.regime.nivel_precedencia_aplicado, 'global');
  assert.equal(combinado.linhas[0].resolucaoPremissas.variacao_preco.nivel_precedencia_aplicado, 'individual');
  assert.equal(combinado.linhas[0].precoAtual, 1150);

  // 6. Expansão proporcional: 40% migra, 60% permanece e a fração fecha 100%.
  const a = { id: 1, lado:'vendas', dimensao:'perfil_cliente', grupo_origem:'indeterminado', grupo_destino:'b2b_credito', percentual_grupo:0.4, variacao_preco:0 };
  const parcial = rodar([p], [], [a]);
  assert.equal(parcial.exp.itens.length, 2);
  assert.equal(Number(parcial.exp.itens.reduce((s, x) => s + x.fracao, 0).toFixed(6)), 1);
  assert.deepEqual(partialGroups(parcial.exp.itens), { b2b_credito: 0.4, indeterminado: 0.6 });

  // 7–9. Produto e serviço classificados seguem classificados; pendentes não
  // recebem classificação/crédito por causa da migração comercial B2B.
  const produto = item('produto', 2);
  const servico = item('servico', 3);
  const produtoPendente = item('produto', 4, '88888888');
  const servicoPendente = item('servico', 5, '888888888');
  const fiscal = rodar([produto, servico, produtoPendente, servicoPendente], [], [a]).linhas
    .filter((x) => x.migracao);
  for (const x of fiscal.filter((x) => [2, 3].includes(x.movimento_id))) {
    assert.equal(x.classificacao.status, 'CLASSIFICADO');
    assert.ok(x.creditoCbs > 0, `${x.tipo}: crédito decorre da regra fiscal elegível`);
  }
  for (const x of fiscal.filter((x) => [4, 5].includes(x.movimento_id))) {
    assert.notEqual(x.classificacao.status, 'CLASSIFICADO');
    assert.equal(x.creditoCbs, 0);
    assert.ok(['INDETERMINADO', 'SUJEITO_VALIDACAO'].includes(x.credito.statusDeterminacao));
  }

  console.log('fase2b-premissas: precedência GLOBAL/GRUPO/INDIVIDUAL, combinação, expansão 100% e preservação fiscal aprovadas.');
} finally { limpar(); }

function partialGroups(itens) {
  return Object.fromEntries(itens.map((x) => [x.grupos.perfil_cliente, x.fracao]));
}

#!/usr/bin/env node
/*
 * Fase 2A — fixtures fiscais isoladas e determinísticas.
 *
 * Não lê movimentos, resultados, empresas ou fotografia compartilhada. As duas
 * linhas de catálogo são criadas exclusivamente para este teste e removidas no
 * finally. O cenário usa a mesma função que a produção usa para recalcular
 * linhas virtuais; não há crédito fixado nem regra tributária duplicada aqui.
 */
const assert = require('node:assert/strict');
const db = require('../src/db');
const motor = require('../src/engine/motor');
const { classificar } = require('../src/engine/classificador');
const cenarioMotor = require('../src/services/cenarioMotor');

const MARCA = 'FIXTURE_FASE2A_B2B_2027';
const CODIGO_PRODUTO = '99990001';
const CODIGO_SERVICO = '999900001';
const LC116_SERVICO = '1.01';
const empresaFixture = { id: -20270, regime: 'regime_regular', razao_social: MARCA };
const contextoB2B = {
  empresa: empresaFixture,
  sentido: 'saida',
  ano: 2027,
  regimeContraparte: 'regime_regular',
  perfilDestinatario: 'b2b',
};
const comum = {
  valor: 1000,
  documento: MARCA,
  cfop: '5102',
  pis: 0,
  cofins: 0,
  icms: 0,
  iss: 0,
};

function instalarFixtures() {
  db.prepare('DELETE FROM base_ncm WHERE ncm=?').run(CODIGO_PRODUTO);
  db.prepare('DELETE FROM base_servicos WHERE nbs=?').run(CODIGO_SERVICO);
  db.prepare(`INSERT INTO base_ncm
    (ncm, descricao, cst, cclasstrib, classificacao, reducao, fundamento, fonte, candidatos)
    VALUES (?, ?, '000', '000001', 'Tributação integral — fixture elegível', 'integral', ?, ?, 1)`)
    .run(CODIGO_PRODUTO, 'Produto fiscal determinístico da Fase 2A', MARCA, MARCA);
  db.prepare(`INSERT INTO base_servicos
    (lc116, nbs, descricao_item, descricao_nbs, cclasstrib, nome_cclasstrib, reducao,
     tratamento_pis_cofins, fundamento_cumulatividade, regra_precedencia)
    VALUES (?, ?, ?, ?, '000001', 'Tributação integral — fixture elegível', 'integral',
      'REGRA_GERAL', ?, ?)`)
    .run(LC116_SERVICO, CODIGO_SERVICO, 'Serviço fiscal determinístico da Fase 2A',
      'Serviço fiscal determinístico da Fase 2A', MARCA, MARCA);
}

function removerFixtures() {
  db.prepare('DELETE FROM base_ncm WHERE ncm=?').run(CODIGO_PRODUTO);
  db.prepare('DELETE FROM base_servicos WHERE nbs=?').run(CODIGO_SERVICO);
}

function peloCenario(item, movimentoId) {
  // A migração comercial para B2B é aplicada pelo orquestrador de cenários.
  // A classificação e o crédito continuam sendo produzidos por motor.projetarItem.
  const base = {
    empresa: empresaFixture,
    ano: 2027,
    brutos: new Map([[movimentoId, item]]),
  };
  const [resultado] = cenarioMotor.recalcular(base, 'vendas', [{
    ...item,
    movimento_id: movimentoId,
    fracao: 1,
    regimeAdquirente: null,
    cnpj: `fixture-${movimentoId}`,
    grupos: { perfil_cliente: 'Perfil desconhecido' },
    migracao: { para: 'b2b_credito', de: 'Perfil desconhecido', percentualGrupo: 1, variacaoPreco: 0 },
  }], []);
  return resultado;
}

function validarClassificado(nome, item, movimentoId) {
  const antes = classificar(item, { ...contextoB2B, perfilDestinatario: 'requer_validacao' });
  const depois = peloCenario(item, movimentoId);
  assert.equal(antes.status, 'CLASSIFICADO', `${nome}: código de catálogo deve classificar antes da premissa B2B`);
  assert.equal(depois.classificacao.status, 'CLASSIFICADO', `${nome}: B2B preserva a classificação fiscal`);
  assert.equal(depois.classificacao.cst, antes.cst, `${nome}: B2B não muda CST`);
  assert.equal(depois.classificacao.cclasstrib, antes.cclasstrib, `${nome}: B2B não muda cClassTrib`);
  assert.ok(depois.cbs > 0, `${nome}: CBS decorre da regra fiscal elegível`);
  assert.ok(depois.creditoCbs > 0, `${nome}: crédito decorre da operação classificada e elegível`);
  assert.equal(depois.creditoCbs, depois.cbs, `${nome}: crédito é o resultado oficial do motor, sem valor mockado`);
}

function validarPendente(nome, item, movimentoId) {
  const antes = classificar(item, contextoB2B);
  const depois = peloCenario(item, movimentoId);
  assert.notEqual(antes.status, 'CLASSIFICADO', `${nome}: código pendente não pode ter classificação inventada`);
  assert.notEqual(depois.classificacao.status, 'CLASSIFICADO', `${nome}: B2B não promove a classificação fiscal`);
  assert.ok(['INDETERMINADO', 'SUJEITO_VALIDACAO'].includes(depois.credito.statusDeterminacao),
    `${nome}: crédito deve permanecer não determinado ou sujeito à validação`);
  assert.equal(depois.creditoCbs, 0, `${nome}: zero exibido é acompanhado de estado não determinado, nunca crédito automático`);
}

try {
  instalarFixtures();
  validarClassificado('PRODUTO_CLASSIFICADO_ELEGIVEL', {
    ...comum, ncm: CODIGO_PRODUTO, descricao: 'Produto classificado e elegível', natureza_item: 'PRODUTO',
  }, -201);
  validarPendente('PRODUTO_NCM_PENDENTE', {
    ...comum, ncm: '99887766', descricao: 'Produto com NCM deliberadamente pendente', natureza_item: 'PRODUTO',
  }, -202);
  validarClassificado('SERVICO_CLASSIFICADO_ELEGIVEL', {
    ...comum, nbs: CODIGO_SERVICO, cst: LC116_SERVICO, iss: 0, descricao: 'Serviço classificado e elegível', natureza_item: 'SERVICO',
  }, -203);
  validarPendente('SERVICO_NBS_PENDENTE', {
    ...comum, nbs: '998877665', cst: '9.99', iss: 0, descricao: 'Serviço com NBS deliberadamente pendente', natureza_item: 'SERVICO',
  }, -204);
  console.log('fase2a-b2b-classificacao: 4 fixtures isoladas passaram pelo classificador, motor fiscal/crédito e orquestrador de cenários.');
} finally {
  removerFixtures();
}

#!/usr/bin/env node
/* Fechamento não apaga dados, registra eventos e protege a geração da entrega. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
process.env.SATTVA_DADOS = path.join(os.tmpdir(), 'sattva-teste-fechamento-modulos');
const db = require('../src/db');
const fechamento = require('../src/services/fechamentoModulos');
const cenarioMotor = require('../src/services/cenarioMotor');

const cnpj = `99${String(Date.now()).slice(-12)}`;
const empresaId = Number(db.prepare('INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)').run(cnpj, 'Empresa de teste de fechamento').lastInsertRowid);

const resultado = { indicadores:{ compras:100, receita:200 }, apuracao:{ cbs:{ debitos:20, creditos:10, liquido:10 }, ibs:{ debitos:0, creditos:0, liquido:0 } } };
const cenarioId = Number(db.prepare("INSERT INTO cenarios (empresa_id,nome,tipo,ano,status,resultado) VALUES (?,?, 'base', 2027, 'calculado', ?)")
  .run(empresaId, 'Fotografia congelada', JSON.stringify(resultado)).lastInsertRowid);
db.prepare('INSERT INTO cenario_composicao (cenario_id,lado,dimensao,grupo,valor,participacao,itens) VALUES (?,?,?,?,?,?,?)')
  .run(cenarioId, 'compras', 'credito_fornecedor', 'normal', 100, 1, 1);
db.prepare('INSERT INTO cenario_composicao (cenario_id,lado,dimensao,grupo,valor,participacao,itens) VALUES (?,?,?,?,?,?,?)')
  .run(cenarioId, 'vendas', 'perfil_cliente', 'b2b_credito', 200, 1, 1);
const congelado = cenarioMotor.obterResultadoPersistido(cenarioId);
assert.equal(congelado.apuracao.cbs.liquido, 10, 'entregável recupera a fotografia persistida sem executar o motor');
assert.equal(congelado.composicao.compras.credito_fornecedor.grupos[0].grupo, 'normal', 'composição congelada permanece disponível');

assert.equal(fechamento.listar(empresaId).pronto_para_entrega, false, 'empresa inicia com módulos abertos');
assert.throws(() => fechamento.exigirProntoParaEntrega(empresaId), /Entregável bloqueado/, 'entrega não é liberada antecipadamente');
assert.equal(fechamento.fechar({ empresaId, modulo:'diagnostico', usuarioId:'teste', observacao:'Dados revisados.' }).modulos[0].status, 'FECHADO');
assert.throws(() => fechamento.exigirAberto(empresaId, 'diagnostico', 'executar o motor'), /está fechado/, 'fechamento bloqueia novo cálculo do diagnóstico');
assert.throws(() => fechamento.reabrir({ empresaId, modulo:'diagnostico', usuarioId:'teste' }), /Informe o motivo/, 'reabertura exige rastreabilidade');
assert.equal(fechamento.reabrir({ empresaId, modulo:'diagnostico', usuarioId:'teste', motivo:'Correção de evidência.' }).modulos[0].status, 'ABERTO');
for (const modulo of fechamento.MODULOS) fechamento.fechar({ empresaId, modulo:modulo.chave, usuarioId:'teste' });
assert.equal(fechamento.exigirProntoParaEntrega(empresaId).pronto_para_entrega, true, 'todos os módulos fechados liberam a entrega');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM empresa_modulos_entrega_eventos WHERE empresa_id=?').get(empresaId).n, 8, 'histórico mantém fechamento e reabertura');
console.log('fechamento-modulos-entregavel: bloqueio do motor, reabertura auditável e gate de entrega aprovados.');

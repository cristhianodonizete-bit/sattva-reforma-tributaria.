#!/usr/bin/env node
/* Regressão: uma NF-e cancelada não pode herdar o grupo de venda do mesmo CFOP. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-perfil-cancelada-'));

const db = require('../src/db');
const perfil = require('../src/services/perfilTributarioHistorico');

db.prepare("INSERT INTO empresas (id,cnpj,razao_social,regime) VALUES (1,'00000000000100','Empresa de teste','simples_nacional')").run();
const inserir = db.prepare(`INSERT INTO movimentos
  (empresa_id,tipo,sentido,competencia,valor,cfop,modelo_documento_fiscal,situacao_documento,origem)
  VALUES (1,'cliente','saida','2026-02',?,?,?,?,'xml')`);
inserir.run(100, '5102', 'nfe', 'AUTORIZADO');
inserir.run(5800, '5102', 'nfe', 'CANCELADO');
inserir.run(5000, '5916', 'nfe', 'AUTORIZADO');
inserir.run(50, '6102', 'nfe', 'AUTORIZADO');

const resultado = perfil.consolidar(db, 1);
const fevereiro = resultado.composicao_receita.filter((x) => x.competencia === '2026-02');
const receita = fevereiro.filter((x) => x.compoe_receita).reduce((s, x) => s + x.valor, 0);
const excluida = fevereiro.filter((x) => !x.compoe_receita).reduce((s, x) => s + x.valor, 0);

assert.equal(receita, 150, 'somente NF-e autorizadas de venda podem compor receita');
assert.equal(excluida, 10800, 'cancelamento e retorno devem permanecer fora da receita');
assert.ok(fevereiro.some((x) => x.cfop === '5102' && !x.compoe_receita && x.valor === 5800), 'cancelada deve aparecer separada do grupo de vendas');
console.log('perfil-receita-cancelada.test: cancelamento separado da venda e receita preservada.');

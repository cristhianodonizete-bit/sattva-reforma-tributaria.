const assert = require('assert');
const sqlite = require('../src/sqlite');
const dados = require('../src/services/dadosAdicionaisAnalise');

const db = sqlite.abrir(':memory:');
db.exec(`
  CREATE TABLE empresas (id integer primary key, razao_social text);
  CREATE TABLE movimentos (id integer primary key, empresa_id integer, competencia text, tipo text, valor real, descricao text, documento text, chave text);
  CREATE TABLE folhas_pagamento_competencias (id integer primary key autoincrement, empresa_id integer, competencia text, valor_folha real, pro_labore real, origem text, referencia_arquivo text, status_validacao text, criado_em text, atualizado_em text, unique(empresa_id, competencia));
  CREATE TABLE margens_operacionais_premissas (id integer primary key autoincrement, empresa_id integer, periodo_inicio text, periodo_fim text, margem_operacional_percentual real, origem text, natureza text, status_validacao text, criado_em text, atualizado_em text, unique(empresa_id, periodo_inicio, periodo_fim));
  CREATE TABLE receitas_sem_dfe (id integer primary key autoincrement, empresa_id integer, competencia text, tipo_receita text, descricao text, valor real, origem text, evidencia text, status_validacao text, chave_deduplicacao text, criado_em text, atualizado_em text, unique(empresa_id, chave_deduplicacao));
`);
db.prepare('INSERT INTO empresas (id,razao_social) VALUES (1,?), (2,?)').run('Empresa A', 'Empresa B');

assert.doesNotThrow(() => dados.salvarFolha(db, 1, { competencia: '2026-08', valor_folha: 10000, pro_labore: 1500, origem: 'PLANILHA_ERP' }));
assert.throws(() => dados.salvarFolha(db, 1, { competencia: '2026-08', valor_folha: 10000 }), /Já existe folha/);
assert.doesNotThrow(() => dados.salvarFolha(db, 2, { competencia: '2026-08', valor_folha: 10000 }), 'isolamento por empresa permite mesma competência');

assert.doesNotThrow(() => dados.salvarMargem(db, 1, { periodo_inicio: '2026-01', periodo_fim: '2026-06', margem_operacional_percentual: 18.5 }));
assert.throws(() => dados.salvarMargem(db, 1, { periodo_inicio: '2026-01', periodo_fim: '2026-06', margem_operacional_percentual: 20 }), /Já existe margem/);
assert.strictEqual(db.prepare('SELECT natureza FROM margens_operacionais_premissas WHERE empresa_id=1').get().natureza, 'PREMISSA_INFORMADA');

const receita = dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-08', tipo_receita: 'ALUGUEL', descricao: 'Aluguel de imóvel', valor: 5000, evidencia: 'Contrato 1' });
assert.strictEqual(receita.possivel_duplicidade, false);
assert.throws(() => dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-08', tipo_receita: 'aluguel', descricao: ' ALUGUEL  DE  IMÓVEL ', valor: 5000 }), /duplicada/);
assert.doesNotThrow(() => dados.salvarReceitaSemDfe(db, 2, { competencia: '2026-08', tipo_receita: 'ALUGUEL', descricao: 'Aluguel de imóvel', valor: 5000 }), 'deduplicação não vaza entre empresas');

db.prepare('INSERT INTO movimentos (empresa_id,competencia,tipo,valor,descricao,documento) VALUES (1,?,?,?,?,?)').run('2026-09', 'cliente', 700, 'Venda já documentada', 'NF-1');
assert.throws(() => dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-09', tipo_receita: 'OUTRA', descricao: 'Venda já documentada', valor: 700 }), /já capturada/);
const possivel = dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-09', tipo_receita: 'CESSAO', descricao: 'Cessão distinta', valor: 700 });
assert.strictEqual(possivel.status_validacao, 'POSSIVEL_DUPLICIDADE');
assert.strictEqual(dados.listar(db, 1).folhas.length, 1);
assert.strictEqual(dados.listar(db, 2).folhas.length, 1);
db.close();
console.log('Fase 4B: folha, margem, receita complementar, deduplicação e isolamento aprovados.');

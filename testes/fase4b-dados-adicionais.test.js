const assert = require('assert');
const sqlite = require('../src/sqlite');
const dados = require('../src/services/dadosAdicionaisAnalise');

const db = sqlite.abrir(':memory:');
db.exec(`
  CREATE TABLE empresas (id integer primary key, razao_social text, regime text);
  CREATE TABLE movimentos (id integer primary key, empresa_id integer, competencia text, tipo text, valor real, descricao text, documento text, chave text);
  CREATE TABLE folhas_pagamento_competencias (id integer primary key autoincrement, empresa_id integer, competencia text, valor_folha real, pro_labore real, origem text, referencia_arquivo text, status_validacao text, criado_em text, atualizado_em text, unique(empresa_id, competencia));
  CREATE TABLE margens_operacionais_premissas (id integer primary key autoincrement, empresa_id integer, periodo_inicio text, periodo_fim text, margem_operacional_percentual real, origem text, natureza text, status_validacao text, criado_em text, atualizado_em text, unique(empresa_id, periodo_inicio, periodo_fim));
  CREATE TABLE receitas_sem_dfe (id integer primary key autoincrement, empresa_id integer, competencia text, tipo_receita text, descricao text, valor real, origem text, evidencia text, status_validacao text, chave_deduplicacao text, criado_em text, atualizado_em text, unique(empresa_id, chave_deduplicacao));
  CREATE TABLE catalogo_itens_receita (chave text primary key, nome text, classificacao_fiscal text, ativo integer);
`);
db.prepare('INSERT INTO empresas (id,razao_social) VALUES (1,?), (2,?)').run('Empresa A', 'Empresa B');
db.prepare("INSERT INTO catalogo_itens_receita (chave,nome,classificacao_fiscal,ativo) VALUES ('ALUGUEL','Aluguel','LOCACAO_IMOVEL',1), ('CESSAO','Cessão','CESSAO_DIREITOS',1), ('OUTRA','Outra','OUTRA',1)").run();

assert.doesNotThrow(() => dados.salvarFolha(db, 1, { competencia: '2026-08', valor_folha: 10000, pro_labore: 1500, origem: 'PLANILHA_ERP' }));
assert.throws(() => dados.salvarFolha(db, 1, { competencia: '2026-08', valor_folha: 10000 }), /Já existe folha/);
assert.doesNotThrow(() => dados.salvarFolha(db, 2, { competencia: '2026-08', valor_folha: 10000 }), 'isolamento por empresa permite mesma competência');
const folhaEditada = dados.editarFolha(db, 1, 1, { competencia: '2026-07', valor_folha: 12000, pro_labore: 1800 });
assert.strictEqual(Number(folhaEditada.id), 1);
const folhaAposEdicao = db.prepare('SELECT competencia,valor_folha,pro_labore,status_validacao FROM folhas_pagamento_competencias WHERE id=1').get();
assert.strictEqual(folhaAposEdicao.competencia, '2026-07');
assert.strictEqual(folhaAposEdicao.valor_folha, 12000);
assert.strictEqual(folhaAposEdicao.pro_labore, 1800);
assert.strictEqual(folhaAposEdicao.status_validacao, 'VALIDADO');
const folhaDuplicada = dados.salvarFolha(db, 1, { competencia: '2026-06', valor_folha: 12000, pro_labore: 1800 });
const consolidacao = dados.editarFolha(db, 1, 1, { competencia: '2026-06', valor_folha: 12000, pro_labore: 1800 });
assert.strictEqual(consolidacao.consolidada, true);
assert.strictEqual(Number(consolidacao.id), Number(folhaDuplicada.id));
assert.strictEqual(db.prepare('SELECT COUNT(*) AS total FROM folhas_pagamento_competencias WHERE empresa_id=1 AND competencia=?').get('2026-06').total, 1);

assert.doesNotThrow(() => dados.salvarMargem(db, 1, { periodo_inicio: '2026-01', periodo_fim: '2026-06', margem_operacional_percentual: 18.5 }));
assert.throws(() => dados.salvarMargem(db, 1, { periodo_inicio: '2026-01', periodo_fim: '2026-06', margem_operacional_percentual: 20 }), /Já existe margem/);
assert.strictEqual(db.prepare('SELECT natureza FROM margens_operacionais_premissas WHERE empresa_id=1').get().natureza, 'PREMISSA_INFORMADA');

const receita = dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-08', tipo_receita: 'ALUGUEL', descricao: 'Aluguel de imóvel', valor: 5000, evidencia: 'Contrato 1' });
assert.strictEqual(receita.possivel_duplicidade, false);
assert.throws(() => dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-08', tipo_receita: 'aluguel', descricao: ' ALUGUEL  DE  IMÓVEL ', valor: 5000 }), /duplicada/);
assert.doesNotThrow(() => dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-10', tipo_receita: 'ALUGUEL', descricao: 'Locação Questor', valor: 1000, identificador_origem: 'REC-100', especie_questor: 'REC' }));
assert.throws(() => dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-10', tipo_receita: 'ALUGUEL', descricao: 'Descrição alterada pelo relatório', valor: 1001, identificador_origem: 'REC-100', especie_questor: 'REC' }), /duplicada/, 'o lançamento REC é a identidade estável mesmo se a descrição ou o valor retornarem diferente');
assert.doesNotThrow(() => dados.salvarReceitaSemDfe(db, 2, { competencia: '2026-08', tipo_receita: 'ALUGUEL', descricao: 'Aluguel de imóvel', valor: 5000 }), 'deduplicação não vaza entre empresas');

db.prepare('INSERT INTO movimentos (empresa_id,competencia,tipo,valor,descricao,documento) VALUES (1,?,?,?,?,?)').run('2026-09', 'cliente', 700, 'Venda já documentada', 'NF-1');
assert.throws(() => dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-09', tipo_receita: 'OUTRA', descricao: 'Venda já documentada', valor: 700 }), /já capturada/);
const possivel = dados.salvarReceitaSemDfe(db, 1, { competencia: '2026-09', tipo_receita: 'CESSAO', descricao: 'Cessão distinta', valor: 700 });
assert.strictEqual(possivel.status_validacao, 'POSSIVEL_DUPLICIDADE');
assert.strictEqual(dados.listar(db, 1).folhas.length, 1);
assert.strictEqual(dados.listar(db, 2).folhas.length, 1);
db.close();
console.log('Fase 4B: folha, margem, receita complementar, deduplicação e isolamento aprovados.');

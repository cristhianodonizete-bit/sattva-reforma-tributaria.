const assert = require('assert');
const sqlite = require('../src/sqlite');
const perfil = require('../src/services/perfilTributarioHistorico');

const db = sqlite.abrir(':memory:');
db.exec(`
  CREATE TABLE empresas (id INTEGER PRIMARY KEY, razao_social TEXT, regime TEXT);
  CREATE TABLE perfil_tributario (empresa_id INTEGER, competencia TEXT, receita_bruta REAL, receita_mercadorias REAL, receita_servicos REAL, receita_exportacao REAL, icms REAL, iss REAL, ipi REAL, pis REAL, cofins REAL, das REAL, creditos_tomados REAL);
  CREATE TABLE movimentos (empresa_id INTEGER, competencia TEXT, tipo TEXT, sentido TEXT, valor REAL, iss REAL);
  CREATE TABLE folhas_pagamento_competencias (empresa_id INTEGER, competencia TEXT, valor_folha REAL);
  CREATE TABLE margens_operacionais_premissas (empresa_id INTEGER, periodo_inicio TEXT, periodo_fim TEXT, margem_operacional_percentual REAL);
  CREATE TABLE receitas_sem_dfe (empresa_id INTEGER, competencia TEXT, valor REAL);
  CREATE TABLE perfil_cbs_competencias (empresa_id INTEGER, competencia TEXT, cbs_debito REAL, cbs_credito REAL, cbs_liquida REAL, motor_execucao_id INTEGER, receita_reducao_cbs REAL, receita_aliquota_zero_cbs REAL, receita_imunidade_cbs REAL, receita_regime_especifico_cbs REAL, receita_beneficio_governo_cbs REAL);
`);
db.prepare("INSERT INTO empresas VALUES (1,'Empresa Simples','simples_nacional')").run();
db.prepare('INSERT INTO perfil_tributario VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(1, '2026-07', 1000, 300, 700, 0, 0, 20, 0, 30, 140, 80);
db.prepare("INSERT INTO movimentos VALUES (1,'2026-07','cliente','saida',900,20)").run();
db.prepare("INSERT INTO folhas_pagamento_competencias VALUES (1,'2026-07',400)").run();
db.prepare("INSERT INTO margens_operacionais_premissas VALUES (1,'2026-01','2026-12',12.5)").run();
db.prepare("INSERT INTO receitas_sem_dfe VALUES (1,'2026-07',100)").run();
db.prepare('INSERT INTO perfil_cbs_competencias VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(1, '2026-07', 90, 10, 80, 14, 0, 0, 0, 0, 0);

const r = perfil.consolidar(db, 1);
assert.strictEqual(r.empresa.regime_atual, 'simples_nacional');
assert.strictEqual(r.historico.length, 1);
const julho = r.historico[0];
assert.strictEqual(julho.receita.valor, 1000);
assert.strictEqual(julho.pgdas.valor, 80);
assert.strictEqual(julho.carga_efetiva_historica.natureza, 'CALCULADO');
assert.strictEqual(julho.cbs_motor_existente.liquida, 80, 'CBS deve ser lida da fotografia materializada');
assert.strictEqual(julho.cbs_motor_existente.motor_execucao_id, 14);
assert.strictEqual(julho.receitas_sem_dfe.valor, 100);

db.prepare("INSERT INTO empresas VALUES (2,'Sem dados','lucro_real')").run();
const vazio = perfil.consolidar(db, 2);
assert.strictEqual(vazio.cobertura.cbs_motor, 'INDETERMINADO');
assert.strictEqual(vazio.historico.length, 0);
db.close();
console.log('Fase 4C: perfil tributário, Raio-X histórico e comparação CBS existente aprovados.');

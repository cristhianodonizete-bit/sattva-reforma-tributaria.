const assert = require('assert');
const sqlite = require('../src/sqlite');
const motor = require('../src/services/motorReceitasSemDfe');

const db = sqlite.abrir(':memory:');
db.exec(`
  CREATE TABLE receitas_sem_dfe (
    id INTEGER PRIMARY KEY, empresa_id INTEGER, competencia TEXT, classificacao_fiscal TEXT, subtipo TEXT,
    status_motor TEXT, regra_motor_id INTEGER, regra_motor_versao INTEGER, regra_motor_atual TEXT, regra_motor_reforma TEXT,
    cst_motor TEXT, cclasstrib_motor TEXT, fundamento_motor TEXT, pendencia_motor TEXT, processado_motor_em TEXT,
    status_comparabilidade TEXT
  );
  CREATE TABLE regras_receitas_sem_dfe (
    id INTEGER PRIMARY KEY, classificacao_fiscal TEXT, subtipo TEXT, tratamento_atual TEXT, tratamento_reforma TEXT,
    cst TEXT, cclasstrib TEXT, fundamento TEXT, vigencia_inicio TEXT, vigencia_fim TEXT, prioridade INTEGER, versao INTEGER, status TEXT, fonte TEXT
  );
  CREATE TABLE catalogo_itens_receita (chave TEXT PRIMARY KEY, nome TEXT, classificacao_fiscal TEXT);
  CREATE TABLE regras_itens_receita_regime (id INTEGER PRIMARY KEY, item_chave TEXT, regime_empresa TEXT, pis_percentual REAL, cofins_percentual REAL, tratamento_atual TEXT, tratamento_reforma TEXT, fundamento TEXT, vigencia_inicio TEXT, vigencia_fim TEXT, ativo INTEGER);
`);
db.prepare(`INSERT INTO regras_receitas_sem_dfe VALUES (1,'LOCACAO_BEM_MOVEL','EQUIPAMENTO','Regra atual','CBS/IBS regular','000','000001','Fonte oficial','2026-01-01',NULL,10,2,'ATIVA','Base oficial')`).run();
db.prepare(`INSERT INTO receitas_sem_dfe (id,empresa_id,competencia,classificacao_fiscal,subtipo,status_motor) VALUES (1,1,'2027-01','LOCACAO_BEM_MOVEL','EQUIPAMENTO','PENDENTE')`).run();

const resultado = motor.aplicar(db, db.prepare('SELECT * FROM receitas_sem_dfe WHERE id=1').get());
assert.strictEqual(resultado.status, 'DETERMINADO');
const persistido = db.prepare('SELECT * FROM receitas_sem_dfe WHERE id=1').get();
assert.strictEqual(persistido.cclasstrib_motor, '000001');
assert.strictEqual(persistido.regra_motor_reforma, 'CBS/IBS regular');

db.prepare("INSERT INTO catalogo_itens_receita VALUES ('LOCACAO_BENS_MOVEIS','Locação de equipamentos','LOCACAO_BEM_MOVEL')").run();
db.prepare("INSERT INTO regras_itens_receita_regime VALUES (2,'LOCACAO_BENS_MOVEIS','lucro_presumido',.0065,.03,'Cumulativo','CBS/IBS em validação','Fonte', '2026-01-01',NULL,1)").run();
db.prepare("INSERT INTO receitas_sem_dfe (id,empresa_id,competencia,classificacao_fiscal,subtipo,status_motor) VALUES (2,1,'2027-01','LOCACAO_BEM_MOVEL','EQUIPAMENTO','PENDENTE')").run();
const regraPorRegime = motor.resolver(db, { id:2, competencia:'2027-01', item_receita_chave:'LOCACAO_BENS_MOVEIS', valor:100 }, 'lucro_presumido');
assert.strictEqual(regraPorRegime.regra.pis_percentual, .0065);
assert.strictEqual(regraPorRegime.regra.cofins_percentual, .03);

const pendente = motor.resolver(db, { competencia: '2027-01', classificacao_fiscal: 'INCORPORACAO_IMOBILIARIA', subtipo: '' });
assert.strictEqual(pendente.status, 'PENDENTE_REGRA');
db.close();
console.log('Motor de receitas sem DF-e: regra versionada, vigência e pendência aprovadas.');

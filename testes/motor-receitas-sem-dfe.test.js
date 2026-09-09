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
`);
db.prepare(`INSERT INTO regras_receitas_sem_dfe VALUES (1,'LOCACAO_BEM_MOVEL','EQUIPAMENTO','Regra atual','CBS/IBS regular','000','000001','Fonte oficial','2026-01-01',NULL,10,2,'ATIVA','Base oficial')`).run();
db.prepare(`INSERT INTO receitas_sem_dfe (id,empresa_id,competencia,classificacao_fiscal,subtipo,status_motor) VALUES (1,1,'2027-01','LOCACAO_BEM_MOVEL','EQUIPAMENTO','PENDENTE')`).run();

const resultado = motor.aplicar(db, db.prepare('SELECT * FROM receitas_sem_dfe WHERE id=1').get());
assert.strictEqual(resultado.status, 'DETERMINADO');
const persistido = db.prepare('SELECT * FROM receitas_sem_dfe WHERE id=1').get();
assert.strictEqual(persistido.cclasstrib_motor, '000001');
assert.strictEqual(persistido.regra_motor_reforma, 'CBS/IBS regular');

const pendente = motor.resolver(db, { competencia: '2027-01', classificacao_fiscal: 'INCORPORACAO_IMOBILIARIA', subtipo: '' });
assert.strictEqual(pendente.status, 'PENDENTE_REGRA');
db.close();
console.log('Motor de receitas sem DF-e: regra versionada, vigência e pendência aprovadas.');

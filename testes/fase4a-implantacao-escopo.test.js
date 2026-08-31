const assert = require('assert');
const sqlite = require('../src/sqlite');
const { escoposCanonicos, gerarChecklist, progresso, STATUS } = require('../src/services/implantacaoEscopo');

const db = sqlite.abrir(':memory:');
db.exec(`CREATE TABLE projeto_entregas (id integer primary key, contratacao_id integer, chave text);
  CREATE TABLE projeto_checklist_implantacao (id integer primary key autoincrement, contratacao_id integer, entrega_id integer, escopo text, chave text, titulo text, tipo_evidencia text, status text, ordem integer, origem text, unique(contratacao_id,chave));`);
db.prepare('INSERT INTO projeto_entregas (id,contratacao_id,chave) VALUES (1,10,\'diagnostico\'),(2,10,\'contratos\'),(3,10,\'precificacao\'),(4,10,\'capacitacao_operacional\')').run();

const escopos = escoposCanonicos(['diagnostico', 'contratos', 'precificacao', 'capacitacao_operacional'], 3);
assert.deepStrictEqual(escopos, ['diagnostico', 'contratos', 'precificacao', 'capacitacao', 'acompanhamento']);
assert.strictEqual(gerarChecklist(db, 10, escopos, 3), 16);
assert.strictEqual(gerarChecklist(db, 10, escopos, 3), 0, 'geração deve ser idempotente');
const itens = db.prepare('SELECT * FROM projeto_checklist_implantacao WHERE contratacao_id=10').all();
assert.strictEqual(itens.length, 16);
assert(itens.every((x) => STATUS.includes(x.status) && x.origem === 'AUTOMATICO'));
assert.strictEqual(itens.find((x) => x.chave === 'diagnostico:SOLICITAR_XML').tipo_evidencia, 'XML_DFE');
assert.strictEqual(itens.find((x) => x.chave === 'contratos:SOLICITAR_CONTRATOS').tipo_evidencia, 'CONTRATO');
const resumo = progresso([{ status: 'VALIDADO' }, { status: 'CONCLUIDO' }, { status: 'COM_PENDENCIA' }, { status: 'RECEBIDO' }]);
assert.deepStrictEqual(resumo, { total: 4, concluidos: 2, pendentes: 1, percentual: 50 });
db.close();
console.log('Fase 4A: checklist automático, múltiplos escopos, status e idempotência aprovados.');

const assert = require('node:assert/strict');
const sqlite = require('../src/sqlite');
const estado = require('../src/services/estadoLeituraEmpresa');

const db = sqlite.abrir(':memory:');
db.exec(`CREATE TABLE empresa_leituras_estado (
  empresa_id INTEGER NOT NULL, recurso TEXT NOT NULL, versao INTEGER NOT NULL,
  situacao TEXT NOT NULL, motivo TEXT, atualizado_em TEXT NOT NULL,
  sincronizado_em TEXT, erro TEXT, PRIMARY KEY (empresa_id,recurso)
)`);

assert.equal(estado.estado(db, 7, ['documentos'])[0].situacao, 'AINDA_NAO_SINCRONIZADO');
estado.invalidar(db, 7, ['documentos'], 'Importação confirmada');
let leitura = estado.estado(db, 7, ['documentos'])[0];
assert.equal(leitura.situacao, 'ATUALIZACAO_PENDENTE');
assert.equal(leitura.versao, 1);

let chamadas = 0;
(async () => {
  await estado.atualizarComSeguranca(db, 7, ['documentos'], async () => { chamadas++; }, { maxAgeMs: 10000 });
  await estado.atualizarComSeguranca(db, 7, ['documentos'], async () => { chamadas++; }, { maxAgeMs: 10000 });
  leitura = estado.estado(db, 7, ['documentos'])[0];
  assert.equal(chamadas, 1, 'leitura recém-sincronizada não deve consultar a fonte novamente');
  assert.equal(leitura.situacao, 'ATUALIZADO');
  assert.equal(leitura.versao, 1, 'sincronização não altera a versão da escrita');
  estado.invalidar(db, 7, ['documentos'], 'Exclusão confirmada');
  assert.equal(estado.estado(db, 7, ['documentos'])[0].versao, 2);
  console.log('estado-leitura-empresa.test: versão, invalidação e leitura curta: OK');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-atualizacoes-'));
process.env.SATTVA_DADOS = dir;
const db = require('../src/db');

try {
  const inserida = db.prepare(`INSERT INTO atualizacoes_reforma
    (titulo,resumo,fonte_nome,fonte_url,tema,impacto_potencial,status)
    VALUES (?,?,?,?,?,?,?)`).run('Nota técnica CBS', 'Resumo', 'Receita Federal', 'https://www.gov.br/receitafederal', 'IBS_CBS', 'MEDIO', 'NOVA');
  const id = Number(inserida.lastInsertRowid);
  db.prepare('INSERT INTO atualizacoes_reforma_eventos (atualizacao_id,acao,dados_json) VALUES (?,?,?)')
    .run(id, 'REGISTRADA', JSON.stringify({ status:'NOVA' }));
  db.prepare("UPDATE atualizacoes_reforma SET status='EM_ANALISE' WHERE id=?").run(id);
  db.prepare('INSERT INTO atualizacoes_reforma_eventos (atualizacao_id,acao,dados_json) VALUES (?,?,?)')
    .run(id, 'STATUS_ALTERADO', JSON.stringify({ anterior:'NOVA', atual:'EM_ANALISE' }));
  const registro = db.prepare('SELECT status,titulo FROM atualizacoes_reforma WHERE id=?').get(id);
  const eventos = db.prepare('SELECT acao FROM atualizacoes_reforma_eventos WHERE atualizacao_id=? ORDER BY id').all(id);
  assert.equal(registro.status, 'EM_ANALISE');
  assert.equal(registro.titulo, 'Nota técnica CBS');
  assert.deepEqual(eventos.map((x) => x.acao), ['REGISTRADA', 'STATUS_ALTERADO']);
  console.log('atualizacoes-reforma: trilha de governança: OK');
} finally {
  try { db.close?.(); } catch (_) {}
  fs.rmSync(dir, { recursive:true, force:true });
}

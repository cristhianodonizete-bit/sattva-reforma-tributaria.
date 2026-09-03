const db = require('../db');

function criar(jobId, empresaId) {
  db.prepare(`INSERT INTO motor_fotografias_staging (job_id,empresa_id,status,atualizado_em)
    VALUES (?,?,'AGUARDANDO',datetime('now','localtime'))
    ON CONFLICT(job_id) DO NOTHING`).run(jobId, empresaId);
  return consultar(jobId);
}
function atualizar(jobId, status, dados = {}) {
  db.prepare(`UPDATE motor_fotografias_staging SET status=?,execucao_id=COALESCE(?,execucao_id),
    quantidade_esperada=COALESCE(?,quantidade_esperada),resumo=COALESCE(?,resumo),erro=?,atualizado_em=datetime('now','localtime') WHERE job_id=?`)
    .run(status, dados.execucao_id ?? null, dados.quantidade_esperada ?? null,
      dados.resumo == null ? null : JSON.stringify(dados.resumo), dados.erro ?? null, jobId);
  return consultar(jobId);
}
function consultar(jobId) { return db.prepare('SELECT * FROM motor_fotografias_staging WHERE job_id=?').get(jobId) || null; }
module.exports = { criar, atualizar, consultar };

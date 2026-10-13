/*
 * A falha precisa ser visível sem reabrir a pendência fiscal nem reutilizar a
 * fotografia antiga. Exercita a fila real (claim, checkpoint e catch), com
 * uma fonte compartilhada indisponível, em SQLite temporário.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-worker-falha-'));
process.env.SATTVA_DADOS = dir;

const db = require('../src/db');
const fila = require('../src/services/processamentoCarteira');
const projecoes = require('../src/services/projecoesMovimentos');

(async () => {
  try {
    const empresaId = Number(db.prepare("INSERT INTO empresas(cnpj,razao_social,regime) VALUES ('99000000000199','Empresa de teste','lucro_real')").run().lastInsertRowid);
    db.prepare("INSERT INTO parceiros(empresa_id,tipo,cnpj,descricao,regime,regime_origem,regime_versao) VALUES (?,'fornecedor','88000000000188','Fornecedor de teste','lucro_real','TESTE',1)").run(empresaId);
    const movimentoId = Number(db.prepare(`INSERT INTO movimentos
      (empresa_id,tipo,nome,inscr_federal,descricao,valor,base_calculo,competencia,regime,regime_fonte,regime_parceiro_versao)
      VALUES (?,'fornecedor','Fornecedor de teste','88000000000188','Movimento de teste',100,100,'2027-01','lucro_real','PARCEIRO_CANONICO',1)`).run(empresaId).lastInsertRowid);
    projecoes.marcar(db,empresaId,[movimentoId],projecoes.ESTADOS.PENDENTE,'Aguardando worker','job-falha');

    const processamentoId = Number(db.prepare("INSERT INTO processamentos_carteira(grupo_id,tipo,status,total_empresas,iniciado_em) VALUES ('teste-falha','MOTOR_INCREMENTAL','AGENDADO',1,datetime('now','localtime'))").run().lastInsertRowid);
    db.prepare(`INSERT INTO jobs_carteira
      (id,processamento_id,grupo_id,empresa_id,competencia,tipo_job,status,tentativas,max_tentativas,payload,criado_em)
      VALUES ('job-falha',?,'teste-falha',?,'2027','MOTOR_INCREMENTAL','PENDENTE',0,1,?,datetime('now','localtime'))`)
      .run(processamentoId,empresaId,JSON.stringify({ movimento_ids:[movimentoId],ano:2027 }));

    await fila.executar(processamentoId);
    const job = db.prepare("SELECT status,erro,payload FROM jobs_carteira WHERE id='job-falha'").get();
    const estado = db.prepare('SELECT situacao,motivo,job_id FROM projecoes_movimentos_estado WHERE empresa_id=? AND movimento_id=?').get(empresaId,movimentoId);
    assert.equal(job.status,'FALHOU');
    assert.match(job.erro,/fonte compartilhada|Supabase|configurada/i);
    assert.equal(JSON.parse(job.payload).etapa,'PREPARANDO_CONTEXTO');
    assert.equal(estado.situacao,projecoes.ESTADOS.FALHOU);
    assert.equal(estado.job_id,'job-falha');
    assert.match(estado.motivo,/Atualização incremental falhou/);
    console.log('worker-incremental-falha-projecao.test: falha real da fila preserva decisão e marca projeção como FALHOU.');
  } finally {
    try { db.close?.(); } catch (_) { /* nada a fazer */ }
    fs.rmSync(dir,{ recursive:true,force:true });
  }
})().catch((erro) => { console.error(erro); process.exitCode=1; });

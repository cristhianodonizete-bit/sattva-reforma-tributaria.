/** Fila durável da carteira: Supabase é a fonte de verdade do job. */
const crypto = require('crypto');
const db = require('../db');
const supabase = require('./supabase');
const bases = require('./basesReforma');
const motorExec = require('./motorExec');
const excecoesMotor = require('./excecoesMotor');

const workerId = `${process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local'}-${process.pid}`;
const id = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const proximaTentativa = (tentativas) => new Date(Date.now() + Math.min(60_000, 1_000 * (2 ** Math.max(0, Number(tentativas) - 1)))).toISOString();
const concorrencia = () => Math.max(1, Math.min(8, Number(process.env.PROCESSAMENTO_CARTEIRA_CONCORRENCIA) || 2));

async function espelharJob(job) {
  if (!supabase.configurado()) return;
  const { error } = await supabase.admin().from('jobs_carteira').upsert({ ...job, payload: JSON.parse(job.payload || '{}') }, { onConflict: 'id' });
  if (error) throw new Error(`Fila Supabase: ${error.message}`);
}

async function iniciar(opcoes = {}) {
  const empresas = opcoes.empresas || db.prepare('SELECT id FROM empresas ORDER BY id').all().map((x) => x.id);
  const competencia = String(opcoes.competencia || '2027');
  const tipo = opcoes.tipo || 'RECALCULO_INCREMENTAL';
  // A mesma empresa/competência/tipo não pode receber dois jobs ativos. Se
  // já existir, o pedido apenas reaproveita o processamento em curso.
  const ativo = empresas.map((empresaId) => db.prepare(`SELECT * FROM jobs_carteira
    WHERE empresa_id=? AND competencia=? AND tipo_job=? AND status IN ('PENDENTE','PROCESSANDO')`).get(empresaId, competencia, tipo)).filter(Boolean);
  if (ativo.length === empresas.length && ativo.length) {
    const processamento = consultar(ativo[0].processamento_id);
    return { ...(processamento || {}), deduplicado: true, jobs: ativo };
  }
  const cab = db.prepare(`INSERT INTO processamentos_carteira (tipo,status,total_empresas,iniciado_em)
    VALUES (?,'AGENDADO',?,datetime('now','localtime'))`).run(tipo, empresas.length);
  const processamentoId = Number(cab.lastInsertRowid);
  const inserirItem = db.prepare("INSERT INTO processamentos_carteira_itens (processamento_id,empresa_id,status) VALUES (?,?,'AGENDADA')");
  const inserirJob = db.prepare(`INSERT INTO jobs_carteira (id,processamento_id,empresa_id,competencia,tipo_job,prioridade,status,payload,criado_em)
    VALUES (?,?,?,?,?,?, 'PENDENTE',?,?)`);
  const jobs = empresas.filter((empresaId) => !ativo.some((j) => Number(j.empresa_id) === Number(empresaId))).map((empresaId) => ({ id: id(), processamento_id: processamentoId, empresa_id: empresaId,
    competencia, tipo_job: tipo, prioridade: Number(opcoes.prioridade) || 0,
    status: 'PENDENTE', tentativas: 0, max_tentativas: 3, payload: JSON.stringify({ incremental: true }), criado_em: agora() }));
  db.transaction(() => jobs.forEach((j) => { inserirItem.run(processamentoId, j.empresa_id); inserirJob.run(j.id, j.processamento_id, j.empresa_id, j.competencia, j.tipo_job, j.prioridade, j.payload, j.criado_em); }))();
  for (const job of jobs) await espelharJob(job);
  executar(processamentoId).catch((e) => console.error('[fila carteira]', e.message));
  return consultar(processamentoId);
}

async function recuperarAbandonados() {
  const limite = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db.prepare("UPDATE jobs_carteira SET status='PENDENTE',worker_id=NULL,heartbeat=NULL,erro=COALESCE(erro || char(10),'') || 'Worker sem heartbeat; retomado.' WHERE status='PROCESSANDO' AND heartbeat<? AND tentativas<max_tentativas").run(limite);
  db.prepare("UPDATE jobs_carteira SET status='FALHOU',finalizado_em=?,erro=COALESCE(erro || char(10),'') || 'Máximo de tentativas.' WHERE status='PROCESSANDO' AND heartbeat<? AND tentativas>=max_tentativas").run(agora(), limite);
  if (supabase.configurado()) {
    const { error } = await supabase.admin().rpc('recuperar_jobs_carteira_abandonados', { p_minutos: 10 });
    if (error) throw new Error(`Recuperação da fila: ${error.message}`);
  }
}

async function claim() {
  if (supabase.configurado()) {
    const { data, error } = await supabase.admin().rpc('claim_job_carteira', { p_worker_id: workerId });
    if (error) throw new Error(`Claim da fila: ${error.message}`);
    if (!data || !data.length) return null;
    const remoto = data[0];
    db.prepare("UPDATE jobs_carteira SET status='PROCESSANDO',worker_id=?,tentativas=?,heartbeat=? WHERE id=?").run(workerId, remoto.tentativas, remoto.heartbeat, remoto.id);
    return { ...remoto, payload: JSON.stringify(remoto.payload || {}) };
  }
  const job = db.prepare("SELECT * FROM jobs_carteira WHERE status='PENDENTE' AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em<=?) ORDER BY prioridade DESC,criado_em LIMIT 1").get(agora());
  if (!job) return null;
  db.prepare("UPDATE jobs_carteira SET status='PROCESSANDO',worker_id=?,tentativas=tentativas+1,iniciado_em=COALESCE(iniciado_em,?),heartbeat=? WHERE id=? AND status='PENDENTE'").run(workerId, agora(), agora(), job.id);
  return db.prepare('SELECT * FROM jobs_carteira WHERE id=?').get(job.id);
}

async function finalizar(job, status, erro = null, dados = {}) {
  const fim = agora();
  db.prepare('UPDATE jobs_carteira SET status=?,heartbeat=?,erro=?,resultado=?,finalizado_em=? WHERE id=?').run(status, fim, erro, JSON.stringify(dados || {}), fim, job.id);
  if (supabase.configurado()) {
    const { error } = await supabase.admin().from('jobs_carteira').update({ status, heartbeat: fim, erro, resultado: dados || {}, finalizado_em: fim }).eq('id', job.id);
    if (error) throw new Error(`Conclusão da fila: ${error.message}`);
  }
  const excecoes = dados.excecoes || { abertas: 0 };
  const statusItem = status === 'CONCLUIDO' ? (excecoes.abertas ? 'COM_EXCECOES' : 'AUTOMATICA') : 'BLOQUEADA';
  db.prepare("UPDATE processamentos_carteira_itens SET status=?,motivo=?,itens_processados=?,excecoes_abertas=?,concluido_em=datetime('now','localtime') WHERE processamento_id=? AND empresa_id=?")
    .run(statusItem, erro || (excecoes.abertas ? 'Casos enviados à Central de Exceções' : 'Processado automaticamente'), dados.itens || 0, excecoes.abertas || 0, job.processamento_id, job.empresa_id);
  const campo = status === 'CONCLUIDO' ? (excecoes.abertas ? 'com_excecoes' : 'automaticas') : 'bloqueadas';
  db.prepare(`UPDATE processamentos_carteira SET processadas=processadas+1, ${campo}=${campo}+1 WHERE id=?`).run(job.processamento_id);
}

async function processarUm() {
  for (;;) {
    const job = await claim();
    if (!job) break;
    try {
      db.prepare('UPDATE jobs_carteira SET heartbeat=? WHERE id=?').run(agora(), job.id);
      bases.classificarMovimentos(job.empresa_id);
      const resultado = motorExec.reprocessarIncremental(job.empresa_id, { ano: Number(job.competencia) || 2027 });
      const excecoes = excecoesMotor.resumo(job.empresa_id);
      await finalizar(job, 'CONCLUIDO', null, { itens: resultado.reprocessados, excecoes });
    } catch (e) {
      const atual = db.prepare('SELECT tentativas,max_tentativas FROM jobs_carteira WHERE id=?').get(job.id) || job;
      const status = Number(atual.tentativas) < Number(atual.max_tentativas) ? 'PENDENTE' : 'FALHOU';
      const proxima = status === 'PENDENTE' ? proximaTentativa(atual.tentativas) : null;
      db.prepare('UPDATE jobs_carteira SET status=?,erro=?,heartbeat=?,proxima_tentativa_em=? WHERE id=?').run(status, e.message, agora(), proxima, job.id);
      if (supabase.configurado()) await supabase.admin().from('jobs_carteira').update({ status, erro: e.message, heartbeat: agora(), proxima_tentativa_em: proxima }).eq('id', job.id);
      if (status === 'FALHOU') await finalizar(job, 'FALHOU', e.message);
    }
  }
}

async function executar(processamentoId = null) {
  await recuperarAbandonados();
  await Promise.all(Array.from({ length: concorrencia() }, () => processarUm()));
  if (processamentoId) db.prepare("UPDATE processamentos_carteira SET status='CONCLUIDO',concluido_em=datetime('now','localtime') WHERE id=? AND processadas>=total_empresas").run(processamentoId);
}

async function cancelar(idJob) {
  const job = db.prepare("SELECT * FROM jobs_carteira WHERE id=? AND status IN ('PENDENTE','PROCESSANDO')").get(idJob);
  if (!job) return { cancelado: false, motivo: 'Job não encontrado ou já finalizado.' };
  db.prepare("UPDATE jobs_carteira SET status='CANCELADO',finalizado_em=?,erro='Cancelado pelo usuário.' WHERE id=?").run(agora(), idJob);
  if (supabase.configurado()) {
    const { error } = await supabase.admin().from('jobs_carteira').update({ status: 'CANCELADO', finalizado_em: agora(), erro: 'Cancelado pelo usuário.' }).eq('id', idJob).in('status', ['PENDENTE','PROCESSANDO']);
    if (error) throw new Error(`Cancelamento da fila: ${error.message}`);
  }
  return { cancelado: true, job_id: idJob };
}

function consultar(idProcessamento) {
  const cabecalho = db.prepare('SELECT * FROM processamentos_carteira WHERE id=?').get(idProcessamento);
  if (!cabecalho) return null;
  const itens = db.prepare('SELECT * FROM processamentos_carteira_itens WHERE processamento_id=? ORDER BY id').all(idProcessamento);
  const jobs = db.prepare('SELECT * FROM jobs_carteira WHERE processamento_id=? ORDER BY prioridade DESC,criado_em').all(idProcessamento);
  return { ...cabecalho, itens, jobs };
}
function ultimo() { const x = db.prepare('SELECT id FROM processamentos_carteira ORDER BY id DESC LIMIT 1').get(); return x ? consultar(x.id) : null; }

module.exports = { iniciar, executar, recuperarAbandonados, consultar, ultimo, cancelar, claim, workerId };

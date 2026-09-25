/** Fila durável da carteira: Supabase é a fonte de verdade do job. */
const crypto = require('crypto');
const db = require('../db');
const supabase = require('./supabase');
const bases = require('./basesReforma');
const motorExec = require('./motorExec');
const excecoesMotor = require('./excecoesMotor');
const motorStaging = require('./motorStaging');

const workerId = `${process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local'}-${process.pid}`;
const id = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const proximaTentativa = (tentativas) => new Date(Date.now() + Math.min(60_000, 1_000 * (2 ** Math.max(0, Number(tentativas) - 1)))).toISOString();
const concorrencia = () => Math.max(1, Math.min(8, Number(process.env.PROCESSAMENTO_CARTEIRA_CONCORRENCIA) || 2));

async function espelharJob(job) {
  if (!supabase.configurado()) return;
  // processamento_id organiza a execução somente no SQLite da instância. Ele
  // pode voltar a 1 após um reinício e, por isso, não é identidade global; o
  // UUID do job é a chave durável usada no Supabase.
  const { error } = await supabase.admin().from('jobs_carteira').upsert({ ...job, payload: JSON.parse(job.payload || '{}') }, { onConflict: 'id' });
  if (error) throw new Error(`Fila Supabase: ${error.message}`);
}

async function iniciar(opcoes = {}) {
  const empresas = opcoes.empresas || db.prepare('SELECT id FROM empresas ORDER BY id').all().map((x) => x.id);
  const competencia = String(opcoes.competencia || '2027');
  const tipo = opcoes.tipo || 'RECALCULO_INCREMENTAL';
  const grupoId = String(opcoes.grupo_id || id());
  // A mesma empresa/competência/tipo não pode receber dois jobs ativos. Se
  // já existir, o pedido apenas reaproveita o processamento em curso.
  const ativo = empresas.map((empresaId) => db.prepare(`SELECT * FROM jobs_carteira
    WHERE empresa_id=? AND competencia=? AND tipo_job=? AND status IN ('PENDENTE','PROCESSANDO')`).get(empresaId, competencia, tipo)).filter(Boolean);
  if (ativo.length === empresas.length && ativo.length) {
    const processamento = consultarLocal(ativo[0].processamento_id);
    return { ...(processamento || {}), grupo_id: ativo[0].grupo_id || null, deduplicado: true, jobs: ativo };
  }
  const cab = db.prepare(`INSERT INTO processamentos_carteira (grupo_id,tipo,status,total_empresas,iniciado_em)
    VALUES (? ,?,'AGENDADO',?,datetime('now','localtime'))`).run(grupoId, tipo, empresas.length);
  const processamentoId = Number(cab.lastInsertRowid);
  const inserirItem = db.prepare("INSERT INTO processamentos_carteira_itens (processamento_id,empresa_id,status) VALUES (?,?,'AGENDADA')");
  const inserirJob = db.prepare(`INSERT INTO jobs_carteira (id,processamento_id,grupo_id,empresa_id,competencia,tipo_job,prioridade,status,payload,criado_em)
    VALUES (?,?,?,?,?,?,?, 'PENDENTE',?,?)`);
  const jobs = empresas.filter((empresaId) => !ativo.some((j) => Number(j.empresa_id) === Number(empresaId))).map((empresaId) => ({ id: id(), processamento_id: processamentoId, grupo_id: grupoId, empresa_id: empresaId,
    competencia, tipo_job: tipo, prioridade: Number(opcoes.prioridade) || 0,
    status: 'PENDENTE', tentativas: 0, max_tentativas: 3, payload: JSON.stringify(opcoes.payload || { incremental: true }), criado_em: agora() }));
  db.transaction(() => jobs.forEach((j) => { inserirItem.run(processamentoId, j.empresa_id); inserirJob.run(j.id, j.processamento_id, j.grupo_id, j.empresa_id, j.competencia, j.tipo_job, j.prioridade, j.payload, j.criado_em); }))();
  for (const job of jobs) await espelharJob(job);
  // O serviço HTTP apenas registra trabalho na fila durável. Consumir a fila
  // neste processo fazia um clique do usuário disputar CPU e memória com as
  // telas, além de tornar o resultado dependente da instância web atual. A
  // execução só é permitida por chamada explícita do processo worker (ou por
  // ferramentas locais de manutenção que optem por iniciarWorker=true).
  if (opcoes.iniciarWorker === true) executar(processamentoId).catch((e) => console.error('[fila carteira]', e.message));
  return { ...consultarLocal(processamentoId), grupo_id: grupoId };
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
    const remotoApi = supabase.admin();
    const { data, error } = await remotoApi.rpc('claim_job_carteira', { p_worker_id: workerId });
    if (!error && data?.length) {
      const remoto = data[0];
      db.prepare("UPDATE jobs_carteira SET status='PROCESSANDO',worker_id=?,tentativas=?,heartbeat=? WHERE id=?").run(workerId, remoto.tentativas, remoto.heartbeat, remoto.id);
      return { ...remoto, payload: JSON.stringify(remoto.payload || {}) };
    }
    // Algumas versões da função RPC não enxergam imediatamente o job recém
    // publicado. Não deixamos a empresa presa na fila: o fallback faz uma
    // atualização condicional no próprio Supabase, que continua atômica entre
    // instâncias e só permite que uma delas assuma o mesmo UUID.
    const local = db.prepare("SELECT * FROM jobs_carteira WHERE status='PENDENTE' AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em<=?) ORDER BY prioridade DESC,criado_em LIMIT 1").get(agora());
    if (!local) {
      if (error) throw new Error(`Claim da fila: ${error.message}`);
      return null;
    }
    const momento = agora();
    const tentativa = Number(local.tentativas || 0) + 1;
    const { data: assumidos, error: erroFallback } = await remotoApi.from('jobs_carteira')
      .update({ status:'PROCESSANDO', worker_id:workerId, tentativas:tentativa, iniciado_em:local.iniciado_em || momento, heartbeat:momento })
      .eq('id', local.id).eq('status', 'PENDENTE').select('*');
    if (erroFallback) throw new Error(`Claim alternativo da fila: ${erroFallback.message}`);
    if (!assumidos?.length) return null;
    const assumido = assumidos[0];
    db.prepare("UPDATE jobs_carteira SET status='PROCESSANDO',worker_id=?,tentativas=?,iniciado_em=COALESCE(iniciado_em,?),heartbeat=? WHERE id=? AND status='PENDENTE'")
      .run(workerId, tentativa, momento, momento, local.id);
    return { ...local, ...assumido, payload: JSON.stringify(assumido.payload || local.payload || {}) };
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
      if (job.tipo_job === 'MOTOR_COMPLETO') {
        const payload = JSON.parse(job.payload || '{}');
        motorStaging.criar(job.id, job.empresa_id);
        motorStaging.atualizar(job.id, 'SINCRONIZANDO_CADASTRO');
        const cnpj = require('./cnpjReceita');
        const operacao = require('./operacaoCompartilhada');
        // A conferência de documentos, período, PGDAS/apurações e receitas é
        // pesada e pertence ao worker. Ela é restrita à empresa e à janela
        // analisada do job; a requisição HTTP apenas enfileira o pedido.
        const preparado = await require('./preparacaoMotor').preparar(job.empresa_id);
        await cnpj.sincronizarConfirmacoesManuaisQsa(Number(job.empresa_id));
        motorStaging.atualizar(job.id, 'CALCULANDO');
        const resultado = motorExec.executar(job.empresa_id, { ano: Number(payload.ano) || Number(job.competencia) || 2027, anexoSimples: payload.anexo, publicarAssincrona: false });
        const execucao = motorExec.ultimaExecucao(job.empresa_id);
        const quantidade = resultado.resumo.itens;
        motorStaging.atualizar(job.id, 'PUBLICANDO', { execucao_id: execucao.id, quantidade_esperada: quantidade, resumo: resultado.resumo });
        const publicacao = await operacao.publicarResultadosMotor(job.empresa_id, { ativar: false });
        // O resultado é publicado com o id da empresa compartilhada. Em
        // instalações em que este difere do id local, promover com o id local
        // encontrava zero itens e descartava uma fotografia já gravada.
        const empresaFotografia = Number(publicacao.empresa_remota_id || job.empresa_id);
        await operacao.promoverFotografiaMotor(empresaFotografia, execucao.id, quantidade);
        await operacao.validarFotografiaAtivaMotor(empresaFotografia, execucao.id, quantidade);
        motorStaging.atualizar(job.id, 'CONCLUIDO');
        await finalizar(job, 'CONCLUIDO', null, { itens: quantidade, execucao_id: execucao.id, periodo: preparado.periodo, reconciliacao_documental: {
          movimentos: preparado.reconciliacao.inseridos_ou_atualizados, removidos: preparado.reconciliacao.removidos, origem: preparado.reconciliacao.origem,
        }, excecoes: excecoesMotor.resumo(job.empresa_id) });
        continue;
      }
      bases.classificarMovimentos(job.empresa_id);
      const resultado = motorExec.reprocessarIncremental(job.empresa_id, { ano: Number(job.competencia) || 2027 });
      const excecoes = excecoesMotor.resumo(job.empresa_id);
      await finalizar(job, 'CONCLUIDO', null, { itens: resultado.reprocessados, excecoes });
    } catch (e) {
      if (job.tipo_job === 'MOTOR_COMPLETO') motorStaging.atualizar(job.id, 'FALHOU', { erro: e.message });
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

function consultarLocal(idProcessamento) {
  const cabecalho = db.prepare('SELECT * FROM processamentos_carteira WHERE id=?').get(idProcessamento);
  if (!cabecalho) return null;
  const itens = db.prepare('SELECT * FROM processamentos_carteira_itens WHERE processamento_id=? ORDER BY id').all(idProcessamento);
  const jobs = db.prepare('SELECT * FROM jobs_carteira WHERE processamento_id=? ORDER BY prioridade DESC,criado_em').all(idProcessamento);
  return { ...cabecalho, itens, jobs };
}

const json = (valor, padrao = {}) => {
  if (valor === null || valor === undefined || valor === '') return padrao;
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
};

function resumirGrupo(grupoId, jobs = []) {
  const normalizados = jobs.map((job) => ({ ...job, resultado: json(job.resultado) }));
  const total = normalizados.length;
  const emExecucao = normalizados.some((job) => job.status === 'PROCESSANDO');
  const pendentes = normalizados.some((job) => job.status === 'PENDENTE');
  const finalizados = normalizados.filter((job) => ['CONCLUIDO','FALHOU','CANCELADO'].includes(job.status));
  const comExcecoes = normalizados.filter((job) => job.status === 'CONCLUIDO' && Number(job.resultado?.excecoes?.abertas || 0) > 0);
  const automaticas = normalizados.filter((job) => job.status === 'CONCLUIDO' && Number(job.resultado?.excecoes?.abertas || 0) === 0);
  const bloqueadas = normalizados.filter((job) => ['FALHOU','CANCELADO'].includes(job.status));
  const status = emExecucao ? 'EXECUTANDO' : pendentes ? 'AGENDADO' : finalizados.length === total ? 'CONCLUIDO' : 'AGENDADO';
  const itens = normalizados.map((job) => ({
    empresa_id: job.empresa_id,
    status: job.status === 'CONCLUIDO' ? (Number(job.resultado?.excecoes?.abertas || 0) ? 'COM_EXCECOES' : 'AUTOMATICA') : job.status,
    motivo: job.erro || null,
    itens_processados: Number(job.resultado?.itens || 0),
    excecoes_abertas: Number(job.resultado?.excecoes?.abertas || 0),
    iniciado_em: job.iniciado_em || null,
    concluido_em: job.finalizado_em || null,
    job_id: job.id,
  }));
  return {
    id: null, grupo_id: grupoId, tipo: normalizados[0]?.tipo_job || null, status,
    total_empresas: total, processadas: finalizados.length, automaticas: automaticas.length,
    com_premissas: 0, com_excecoes: comExcecoes.length, bloqueadas: bloqueadas.length,
    iniciado_em: normalizados.map((job) => job.iniciado_em).filter(Boolean).sort()[0] || null,
    concluido_em: finalizados.length === total ? normalizados.map((job) => job.finalizado_em).filter(Boolean).sort().at(-1) || null : null,
    criado_em: normalizados.map((job) => job.criado_em).filter(Boolean).sort()[0] || null,
    itens, jobs: normalizados,
  };
}

async function consultarCompartilhado(grupoId) {
  if (!grupoId || !supabase.configurado()) return null;
  const { data, error } = await supabase.admin().from('jobs_carteira')
    .select('id,grupo_id,empresa_id,competencia,tipo_job,prioridade,status,tentativas,max_tentativas,erro,resultado,criado_em,iniciado_em,finalizado_em')
    .eq('grupo_id', grupoId).order('prioridade', { ascending: false }).order('criado_em', { ascending: true });
  if (error) throw new Error(`Acompanhamento compartilhado da fila: ${error.message}`);
  return data?.length ? resumirGrupo(grupoId, data) : null;
}

async function consultar(identificador) {
  const texto = String(identificador || '');
  const local = /^\d+$/.test(texto) ? consultarLocal(Number(texto)) : null;
  const grupoId = local?.grupo_id || (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(texto) ? texto : null);
  try {
    const compartilhado = await consultarCompartilhado(grupoId);
    return compartilhado || local;
  } catch (erro) {
    // Status é observabilidade. Uma indisponibilidade transitória não pode
    // transformar a tela de controle em erro 502, nem autoriza alterar jobs.
    console.error('[fila] acompanhamento compartilhado indisponível:', erro.message);
    return local;
  }
}

async function ultimo() {
  try {
    if (supabase.configurado()) {
      const { data, error } = await supabase.admin().from('jobs_carteira').select('grupo_id')
        .not('grupo_id', 'is', null).order('criado_em', { ascending: false }).limit(1);
      if (error) throw new Error(`Último processamento compartilhado: ${error.message}`);
      if (data?.[0]?.grupo_id) return consultarCompartilhado(data[0].grupo_id);
    }
  } catch (erro) {
    console.error('[fila] último processamento compartilhado indisponível:', erro.message);
  }
  const x = db.prepare('SELECT id FROM processamentos_carteira ORDER BY id DESC LIMIT 1').get();
  return x ? consultarLocal(x.id) : null;
}

module.exports = { iniciar, executar, recuperarAbandonados, consultar, ultimo, cancelar, claim, workerId, resumirGrupo };

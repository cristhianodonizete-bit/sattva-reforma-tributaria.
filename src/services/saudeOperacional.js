/* Painel operacional: agrega observabilidade; nunca processa ou altera fatos. */
const integridade = require('./integridadeOperacional');

function numero(valor) { return Number(valor || 0); }

async function resumo(db, { supabase, telemetria, memoria = process.memoryUsage() }) {
  const local = telemetria.resumo();
  const empresas = db.prepare('SELECT id FROM empresas ORDER BY id').all();
  const integridades = empresas.map((empresa) => integridade.auditar(db, empresa.id));
  const alertaIntegridade = integridades.filter((x) => x.situacao !== 'INTEGRO');
  let jobs = [];
  let erroFila = null;
  if (supabase.configurado()) {
    const { data, error } = await supabase.admin().from('jobs_carteira')
      .select('id,empresa_id,status,tentativas,max_tentativas,heartbeat,criado_em,finalizado_em,erro')
      .order('criado_em', { ascending:false }).limit(100);
    if (error) erroFila = error.message; else jobs = data || [];
  }
  const porStatus = jobs.reduce((mapa, job) => ({ ...mapa, [job.status]:numero(mapa[job.status]) + 1 }), {});
  const agora = Date.now();
  const processando = jobs.find((job) => job.status === 'PROCESSANDO') || null;
  const heartbeatRecente = processando?.heartbeat && agora - Date.parse(processando.heartbeat) < 60_000;
  const pendente = jobs.find((job) => job.status === 'PENDENTE') || null;
  const worker = processando
    ? { situacao:heartbeatRecente ? 'PROCESSANDO_COM_HEARTBEAT' : 'PROCESSAMENTO_SEM_HEARTBEAT_RECENTE', job_id:processando.id, heartbeat:processando.heartbeat }
    : pendente ? { situacao:'FILA_AGUARDANDO_WORKER', job_id:pendente.id, criado_em:pendente.criado_em }
      : { situacao:'OCIOSO_NAO_VERIFICAVEL', motivo:'O heartbeat atual é registrado somente durante jobs em execução.' };
  const rotasLentas = (local.rotas || []).filter((rota) => numero(rota.p95_ms) >= 1000);
  const alertas = [];
  if (erroFila) alertas.push({ gravidade:'ALTA', codigo:'FILA_INDISPONIVEL', mensagem:erroFila });
  if (worker.situacao === 'PROCESSAMENTO_SEM_HEARTBEAT_RECENTE') alertas.push({ gravidade:'ALTA', codigo:'WORKER_SEM_HEARTBEAT', mensagem:'Há job em processamento sem heartbeat recente.' });
  if (worker.situacao === 'FILA_AGUARDANDO_WORKER') alertas.push({ gravidade:'MEDIA', codigo:'FILA_AGUARDANDO', mensagem:'Há job pendente aguardando worker.' });
  if (porStatus.FALHOU) alertas.push({ gravidade:'MEDIA', codigo:'JOBS_FALHOS', mensagem:`Há ${porStatus.FALHOU} job(s) falho(s) no histórico recente.` });
  if (alertaIntegridade.length) alertas.push({ gravidade:'ALTA', codigo:'INTEGRIDADE_EMPRESA', mensagem:`${alertaIntegridade.length} empresa(s) exigem revisão de integridade.` });
  if (rotasLentas.length) alertas.push({ gravidade:'MEDIA', codigo:'ROTAS_LENTAS', mensagem:`${rotasLentas.length} rota(s) com p95 acima de 1 segundo.` });
  return {
    natureza:'PAINEL_SOMENTE_LEITURA', gerado_em:new Date().toISOString(),
    web:{ heap_mb:Math.round(numero(memoria.heapUsed) / 1024 / 1024 * 100) / 100, rss_mb:Math.round(numero(memoria.rss) / 1024 / 1024 * 100) / 100 },
    worker, fila:{ por_status:porStatus, ultimos_jobs:jobs.slice(0, 10), erro:erroFila },
    performance:{ requisicoes:local.total_requisicoes, rotas_lentas:rotasLentas },
    integridade:{ empresas_analisadas:integridades.length, atencao:alertaIntegridade.map((x) => ({ empresa:x.empresa, situacao:x.situacao, achados:x.achados })) },
    alertas,
  };
}

module.exports = { resumo };

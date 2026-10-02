/* Painel operacional: agrega observabilidade; nunca processa ou altera fatos. */
const integridade = require('./integridadeOperacional');
const { Client } = require('pg');

function numero(valor) { return Number(valor || 0); }

async function lerFatosDuraveis(empresas, { connectionString = process.env.SUPABASE_DB_URL } = {}) {
  if (!connectionString || !empresas.length) return { disponivel:false, motivo:'SUPABASE_DB_URL não configurada para a conferência durável.' };
  const client = new Client({ connectionString, ssl:{ rejectUnauthorized:false }, connectionTimeoutMillis:8_000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='5000'");
    const { rows } = await client.query(`
      WITH empresas_alvo AS (
        SELECT id,COALESCE(origem_local_id,id)::bigint empresa_local_id,regime
          FROM public.empresas
         WHERE origem_local_id = ANY($1::bigint[]) OR id = ANY($1::bigint[])
      ), movimentos AS (
        SELECT empresa_id,count(*)::int documentos,
          count(*) FILTER (WHERE lower(coalesce(sentido,''))='saida' AND coalesce(situacao_documento,'AUTORIZADO') NOT IN ('CANCELADO','DENEGADO','INUTILIZADO'))::int saidas
          FROM public.movimentos WHERE empresa_id IN (SELECT id FROM empresas_alvo) GROUP BY empresa_id
      ), perfil AS (
        SELECT empresa_id,count(*) FILTER (WHERE coalesce(competencia,'')<>'')::int perfil_competencias
          FROM public.perfil_tributario WHERE empresa_id IN (SELECT id FROM empresas_alvo) GROUP BY empresa_id
      ), pgdas AS (
        SELECT empresa_id,count(*) FILTER (WHERE status_processamento='VALIDADO_USUARIO')::int pgdas_validados
          FROM public.pgdas_documentos WHERE empresa_id IN (SELECT id FROM empresas_alvo) GROUP BY empresa_id
      ), apuracoes AS (
        SELECT empresa_id,count(*) FILTER (WHERE status_processamento='VALIDADO_USUARIO')::int apuracoes_validadas
          FROM public.pis_cofins_apuracao_documentos WHERE empresa_id IN (SELECT id FROM empresas_alvo) GROUP BY empresa_id
      ), resultados AS (
        SELECT empresa_id,count(*) FILTER (WHERE ativo=true)::int resultados_ativos
          FROM public.motor_resultados_operacionais WHERE empresa_id IN (SELECT id FROM empresas_alvo) GROUP BY empresa_id
      )
      SELECT a.empresa_local_id,coalesce(m.documentos,0) documentos,coalesce(m.saidas,0) saidas,
        coalesce(p.perfil_competencias,0) perfil_competencias,coalesce(g.pgdas_validados,0) pgdas_validados,
        coalesce(ap.apuracoes_validadas,0) apuracoes_validadas,coalesce(r.resultados_ativos,0) resultados_ativos
        FROM empresas_alvo a
        LEFT JOIN movimentos m ON m.empresa_id=a.id LEFT JOIN perfil p ON p.empresa_id=a.id
        LEFT JOIN pgdas g ON g.empresa_id=a.id LEFT JOIN apuracoes ap ON ap.empresa_id=a.id
        LEFT JOIN resultados r ON r.empresa_id=a.id`, [empresas.map((empresa) => Number(empresa.id))]);
    await client.query('ROLLBACK');
    return { disponivel:true, por_empresa:new Map(rows.map((linha) => [Number(linha.empresa_local_id), linha])) };
  } catch (erro) {
    try { await client.query('ROLLBACK'); } catch { /* conexão pode não ter iniciado */ }
    return { disponivel:false, motivo:erro.message };
  } finally { await client.end().catch(() => {}); }
}

async function resumo(db, { supabase, telemetria, memoria = process.memoryUsage(), lerFatos = lerFatosDuraveis }) {
  const local = telemetria.resumo();
  const empresas = db.prepare('SELECT id FROM empresas ORDER BY id').all();
  const fonteDuravel = await lerFatos(empresas);
  const integridades = empresas.map((empresa) => integridade.auditar(db, empresa.id, { fatosDuraveis:fonteDuravel.por_empresa?.get(Number(empresa.id)) || null }));
  const alertaIntegridade = integridades.filter((x) => x.situacao !== 'INTEGRO');
  let jobs = [];
  let erroFila = null;
  let presencaWorker = null;
  let erroHeartbeat = null;
  if (supabase.configurado()) {
    const { data, error } = await supabase.admin().from('jobs_carteira')
      .select('id,empresa_id,status,tentativas,max_tentativas,heartbeat,criado_em,finalizado_em,erro')
      .order('criado_em', { ascending:false }).limit(100);
    if (error) erroFila = error.message; else jobs = data || [];
    const { data: heartbeats, error: erroPresenca } = await supabase.admin().from('worker_heartbeats')
      .select('worker_id,status,heartbeat,iniciado_em,atualizado_em,detalhes')
      .order('heartbeat', { ascending:false }).limit(1);
    if (erroPresenca) erroHeartbeat = erroPresenca.message;
    else presencaWorker = (heartbeats || [])[0] || null;
  }
  const porStatus = jobs.reduce((mapa, job) => ({ ...mapa, [job.status]:numero(mapa[job.status]) + 1 }), {});
  const ultimoConcluido = jobs.find((job) => job.status === 'CONCLUIDO') || null;
  const ultimoFalho = jobs.find((job) => job.status === 'FALHOU') || null;
  const agora = Date.now();
  const processando = jobs.find((job) => job.status === 'PROCESSANDO') || null;
  const heartbeatRecente = processando?.heartbeat && agora - Date.parse(processando.heartbeat) < 60_000;
  const presencaRecente = presencaWorker?.heartbeat && agora - Date.parse(presencaWorker.heartbeat) < 90_000;
  const pendente = jobs.find((job) => job.status === 'PENDENTE') || null;
  const worker = processando
    ? { situacao:heartbeatRecente ? 'PROCESSANDO_COM_HEARTBEAT' : 'PROCESSAMENTO_SEM_HEARTBEAT_RECENTE', job_id:processando.id, heartbeat:processando.heartbeat }
    : presencaRecente && presencaWorker.status === 'ATIVO' ? { situacao:'OCIOSO_COM_HEARTBEAT', ...presencaWorker }
      : presencaRecente && presencaWorker.status === 'PAUSADO' ? { situacao:'PAUSADO', ...presencaWorker }
        : pendente ? { situacao:'FILA_AGUARDANDO_WORKER', job_id:pendente.id, criado_em:pendente.criado_em, ultimo_heartbeat:presencaWorker?.heartbeat || null }
          : presencaWorker ? { situacao:'SEM_HEARTBEAT_RECENTE', ...presencaWorker }
            : { situacao:erroHeartbeat ? 'HEARTBEAT_INDISPONIVEL' : 'SEM_HEARTBEAT_REGISTRADO', motivo:erroHeartbeat || 'O worker ainda não registrou presença.' };
  const rotasLentas = (local.rotas || []).filter((rota) => numero(rota.p95_ms) >= 1000);
  const alertas = [];
  if (erroFila) alertas.push({ gravidade:'ALTA', codigo:'FILA_INDISPONIVEL', mensagem:erroFila });
  if (erroHeartbeat) alertas.push({ gravidade:'MEDIA', codigo:'HEARTBEAT_INDISPONIVEL', mensagem:erroHeartbeat });
  if (!fonteDuravel.disponivel) alertas.push({ gravidade:'MEDIA', codigo:'FONTE_INTEGRIDADE_INDISPONIVEL', mensagem:'A conferência durável não respondeu; os alertas de integridade abaixo usam apenas o cache local.' });
  if (worker.situacao === 'PROCESSAMENTO_SEM_HEARTBEAT_RECENTE') alertas.push({ gravidade:'ALTA', codigo:'WORKER_SEM_HEARTBEAT', mensagem:'Há job em processamento sem heartbeat recente.' });
  if (worker.situacao === 'FILA_AGUARDANDO_WORKER') alertas.push({ gravidade:'MEDIA', codigo:'FILA_AGUARDANDO', mensagem:'Há job pendente aguardando worker.' });
  if (worker.situacao === 'SEM_HEARTBEAT_RECENTE') alertas.push({ gravidade:'ALTA', codigo:'WORKER_SEM_SINAL', mensagem:'O worker não registrou presença recente.' });
  if (porStatus.FALHOU) alertas.push({ gravidade:'MEDIA', codigo:'JOBS_FALHOS', mensagem:`Há ${porStatus.FALHOU} job(s) falho(s) no histórico recente.` });
  if (alertaIntegridade.length) alertas.push({ gravidade:'ALTA', codigo:'INTEGRIDADE_EMPRESA', mensagem:`${alertaIntegridade.length} empresa(s) exigem revisão de integridade.` });
  if (rotasLentas.length) alertas.push({ gravidade:'MEDIA', codigo:'ROTAS_LENTAS', mensagem:`${rotasLentas.length} rota(s) com p95 acima de 1 segundo.` });
  return {
    natureza:'PAINEL_SOMENTE_LEITURA', gerado_em:new Date().toISOString(),
    web:{ situacao:'ONLINE', heap_mb:Math.round(numero(memoria.heapUsed) / 1024 / 1024 * 100) / 100, rss_mb:Math.round(numero(memoria.rss) / 1024 / 1024 * 100) / 100 },
    worker, fila:{
      por_status:porStatus,
      pendentes:numero(porStatus.PENDENTE),
      falhos:numero(porStatus.FALHOU),
      ultimo_concluido:ultimoConcluido,
      ultimo_falho:ultimoFalho,
      ultimos_jobs:jobs.slice(0, 10),
      erro:erroFila,
    },
    performance:{ requisicoes:local.total_requisicoes, rotas_lentas:rotasLentas },
    integridade:{ fonte:fonteDuravel.disponivel ? 'SUPABASE_DURAVEL' : 'CACHE_LOCAL', empresas_analisadas:integridades.length, atencao:alertaIntegridade.map((x) => ({ empresa:x.empresa, situacao:x.situacao, achados:x.achados })) },
    alertas,
  };
}

module.exports = { resumo, lerFatosDuraveis };

/* Presença operacional do worker. Não participa de cálculo ou de dados fiscais. */
const supabase = require('./supabase');

function identificador() {
  // Há somente um consumidor intencional da fila. Um identificador estável evita
  // acumular registros a cada deploy; pode ser separado se houver escala futura.
  return String(process.env.WORKER_IDENTIFICADOR || process.env.RENDER_SERVICE_ID || 'worker-principal');
}

async function registrar(status, detalhe = null) {
  if (!supabase.configurado()) return { registrado:false, motivo:'FONTE_COMPARTILHADA_NAO_CONFIGURADA' };
  const agora = new Date().toISOString();
  const detalhes = {
    worker_ativo: String(process.env.WORKER_ATIVO || '').toLowerCase() === 'true',
    intervalo_ms: Math.max(5_000, Number(process.env.WORKER_INTERVALO_MS) || 15_000),
  };
  if (detalhe) detalhes.ultimo_erro = String(detalhe).slice(0, 500);
  const { error } = await supabase.admin().from('worker_heartbeats').upsert({
    worker_id:identificador(), status, heartbeat:agora, atualizado_em:agora, detalhes,
  }, { onConflict:'worker_id' });
  if (error) throw new Error(error.message);
  return { registrado:true, worker_id:identificador(), heartbeat:agora };
}

module.exports = { identificador, registrar };

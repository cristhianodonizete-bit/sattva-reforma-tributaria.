require('dotenv').config();

// Processo separado do HTTP. Por segurança nasce pausado: criar o serviço no
// Render não pode assumir jobs, executar motor ou alterar dados sem a decisão
// explícita de definir WORKER_ATIVO=true.
const ativo = String(process.env.WORKER_ATIVO || '').toLowerCase() === 'true';
const escritasAutomaticasPermitidas = String(process.env.ESCRITAS_AUTOMATICAS_PERMITIDAS || '').toLowerCase() === 'true';
const consumidorAtivo = ativo && escritasAutomaticasPermitidas;
const intervaloMs = Math.max(5_000, Number(process.env.WORKER_INTERVALO_MS) || 15_000);
const heartbeat = require('./src/services/workerHeartbeat');

function relatarConfiguracao() {
  // Diagnóstico sem vazar nomes, URLs ou segredos. Isso permite validar a
  // preparação do worker ainda pausado, antes de ele poder assumir um job.
  const supabaseOk = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const pgdasOk = Boolean(process.env.SUPABASE_DB_URL);
  console.log(`worker fonte compartilhada: ${supabaseOk ? 'CONFIGURADA' : 'INCOMPLETA'}; PGDAS: ${pgdasOk ? 'CONFIGURADO' : 'INCOMPLETO'}`);
}

async function ciclo() {
  if (!consumidorAtivo) return;
  const fila = require('./src/services/processamentoCarteira');
  // Não sincronizar a carteira inteira ao iniciar o worker. A fila
  // compartilhada entrega um job por vez e cada job prepara exclusivamente
  // sua empresa e período; assim 100 mil documentos de uma empresa não
  // viram carga-base para todos os processos.
  await fila.executar();
}

async function registrarHeartbeat(status, erro = null) {
  if (!escritasAutomaticasPermitidas) {
    console.info('worker: heartbeat suprimido; ESCRITAS_AUTOMATICAS_PERMITIDAS diferente de true.');
    return { registrado:false, motivo:'ESCRITAS_AUTOMATICAS_BLOQUEADAS' };
  }
  // Observabilidade jamais pode interromper a fila. Falhar ao registrar a
  // presença é informado no log, enquanto o processamento continua seguro.
  try { await heartbeat.registrar(status, erro); }
  catch (falha) { console.error('worker: não foi possível registrar heartbeat:', falha.message); }
}

async function iniciar() {
  console.log(`worker iniciado: ${consumidorAtivo ? 'ATIVO' : 'PAUSADO'}; intervalo ${intervaloMs} ms`);
  relatarConfiguracao();
  await registrarHeartbeat(consumidorAtivo ? 'ATIVO' : 'PAUSADO');
  if (!consumidorAtivo) {
    // Mantém o processo vivo para validar deploy, variáveis e conectividade
    // sem processar qualquer informação fiscal.
    setInterval(() => {
      console.log('worker pausado; defina WORKER_ATIVO=true e ESCRITAS_AUTOMATICAS_PERMITIDAS=true para consumir a fila.');
      void registrarHeartbeat('PAUSADO');
    }, 60 * 60 * 1000);
    return;
  }
  let executando = false;
  const rodar = async () => {
    if (executando) return;
    executando = true;
    try { await ciclo(); await registrarHeartbeat('ATIVO'); }
    catch (erro) {
      console.error('worker: ciclo falhou sem perder jobs:', erro.message);
      await registrarHeartbeat('ERRO', erro.message);
    } finally { executando = false; }
  };
  await rodar();
  setInterval(rodar, intervaloMs);
  setInterval(() => { void registrarHeartbeat('ATIVO'); }, 30_000);
}

iniciar().catch((erro) => { console.error('worker não iniciou:', erro.message); process.exitCode = 1; });

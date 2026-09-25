require('dotenv').config();

// Processo separado do HTTP. Por segurança nasce pausado: criar o serviço no
// Render não pode assumir jobs, executar motor ou alterar dados sem a decisão
// explícita de definir WORKER_ATIVO=true.
const ativo = String(process.env.WORKER_ATIVO || '').toLowerCase() === 'true';
const intervaloMs = Math.max(5_000, Number(process.env.WORKER_INTERVALO_MS) || 15_000);

function relatarConfiguracao() {
  // Diagnóstico sem vazar nomes, URLs ou segredos. Isso permite validar a
  // preparação do worker ainda pausado, antes de ele poder assumir um job.
  const supabaseOk = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const pgdasOk = Boolean(process.env.SUPABASE_DB_URL);
  console.log(`worker fonte compartilhada: ${supabaseOk ? 'CONFIGURADA' : 'INCOMPLETA'}; PGDAS: ${pgdasOk ? 'CONFIGURADO' : 'INCOMPLETO'}`);
}

async function ciclo() {
  if (!ativo) return;
  const fila = require('./src/services/processamentoCarteira');
  // Não sincronizar a carteira inteira ao iniciar o worker. A fila
  // compartilhada entrega um job por vez e cada job prepara exclusivamente
  // sua empresa e período; assim 100 mil documentos de uma empresa não
  // viram carga-base para todos os processos.
  await fila.executar();
}

async function iniciar() {
  console.log(`worker iniciado: ${ativo ? 'ATIVO' : 'PAUSADO'}; intervalo ${intervaloMs} ms`);
  relatarConfiguracao();
  if (!ativo) {
    // Mantém o processo vivo para validar deploy, variáveis e conectividade
    // sem processar qualquer informação fiscal.
    setInterval(() => console.log('worker pausado; defina WORKER_ATIVO=true para consumir a fila.'), 60 * 60 * 1000);
    return;
  }
  let executando = false;
  const rodar = async () => {
    if (executando) return;
    executando = true;
    try { await ciclo(); }
    catch (erro) { console.error('worker: ciclo falhou sem perder jobs:', erro.message); }
    finally { executando = false; }
  };
  await rodar();
  setInterval(rodar, intervaloMs);
}

iniciar().catch((erro) => { console.error('worker não iniciou:', erro.message); process.exitCode = 1; });

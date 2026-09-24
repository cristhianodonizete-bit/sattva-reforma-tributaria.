require('dotenv').config();

// Processo separado do HTTP. Por segurança nasce pausado: criar o serviço no
// Render não pode assumir jobs, executar motor ou alterar dados sem a decisão
// explícita de definir WORKER_ATIVO=true.
const ativo = String(process.env.WORKER_ATIVO || '').toLowerCase() === 'true';
const intervaloMs = Math.max(5_000, Number(process.env.WORKER_INTERVALO_MS) || 15_000);

async function ciclo() {
  if (!ativo) return;
  const operacao = require('./src/services/operacaoCompartilhada');
  const fila = require('./src/services/processamentoCarteira');
  // A fila compartilhada é a autoridade para assumir trabalho. A preparação
  // local ocorre antes de qualquer claim e uma falha não descarta o job.
  await operacao.sincronizarIncremental();
  await fila.executar();
}

async function iniciar() {
  console.log(`worker iniciado: ${ativo ? 'ATIVO' : 'PAUSADO'}; intervalo ${intervaloMs} ms`);
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

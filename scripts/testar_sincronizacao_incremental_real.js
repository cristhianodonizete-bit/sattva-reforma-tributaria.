require('dotenv').config();
const operacao = require('../src/services/operacaoCompartilhada');

async function executar() {
  if (!operacao.ativo()) throw new Error('Operação compartilhada não está configurada.');
  let primeira;
  try { primeira = await operacao.sincronizarIncremental(); }
  catch (erro) {
    const diagnostico = await operacao.baixar();
    console.error(`Diagnóstico da carga-base: ${JSON.stringify(diagnostico.falhas || {})}`);
    throw erro;
  }
  if (primeira.modo !== 'carga_base') throw new Error(`Esperada carga-base no banco temporário; recebido ${primeira.modo}.`);
  const segunda = await operacao.sincronizarIncremental();
  if (segunda.modo === 'carga_base' || segunda.modo === 'fallback_completo') {
    throw new Error(`A segunda execução deveria ser incremental; recebido ${segunda.modo}.`);
  }
  console.log(JSON.stringify({ primeira: { modo: primeira.modo, sequencia: primeira.sequencia }, segunda }, null, 2));
}

executar().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

/* Adaptador opcional do Azure Document Intelligence.
 * Credenciais ficam exclusivamente em variáveis de ambiente. O resultado é
 * somente leitura/OCR; a normalização continua a cargo da camada LLM Sattva.
 */
function config() {
  const endpoint = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').trim().replace(/\/$/, '');
  const key = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '').trim();
  return { endpoint, key, ativo: Boolean(endpoint && key), modelo: 'prebuilt-layout', versao: '2024-11-30' };
}

// Não retorna valores de configuração. Serve apenas para distinguir ausência
// de ambiente de falha posterior de OCR/normalização.
function diagnosticoSeguro() {
  const cfg = config();
  const endpointValido = /^https:\/\/[^\s/]+(?:\/.*)?$/i.test(cfg.endpoint);
  const endpointConfigurado = Boolean(cfg.endpoint);
  const keyConfigurada = Boolean(cfg.key);
  return {
    endpoint_configurado: endpointConfigurado,
    key_configurada: keyConfigurada,
    endpoint_valido: endpointValido,
    azure_configurado: endpointConfigurado && keyConfigurada && endpointValido,
    motivo_inativo: !endpointConfigurado ? 'AZURE_ENDPOINT_AUSENTE'
      : !keyConfigurada ? 'AZURE_KEY_AUSENTE'
        : !endpointValido ? 'AZURE_ENDPOINT_INVALIDO'
          : null,
  };
}

function espera(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function requisitarComEspera(url, opcoes, contexto) {
  // 429 é controle de taxa do Azure, não falha do PDF. Respeita o prazo que
  // o serviço informar antes de continuar o lote automaticamente.
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const resposta = await fetch(url, opcoes);
    if (resposta.status !== 429 || tentativa === 5) return resposta;
    const retryAfter = Number(resposta.headers.get('retry-after'));
    const segundos = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.min(30, 5 * (tentativa + 1));
    await espera(segundos * 1000);
  }
  throw new Error(`${contexto} excedeu o limite de tentativas.`);
}
function textoResultado(resultado) {
  const paragrafos = resultado?.analyzeResult?.paragraphs || [];
  const tabelas = (resultado?.analyzeResult?.tables || []).flatMap((tabela) => {
    const linhas = new Map();
    (tabela.cells || []).forEach((celula) => {
      const indice = Number(celula.rowIndex || 0); if (!linhas.has(indice)) linhas.set(indice, []);
      linhas.get(indice).push(celula);
    });
    return [...linhas.entries()].sort((a,b) => a[0] - b[0]).map(([, celulas]) => celulas.sort((a,b) => Number(a.columnIndex || 0) - Number(b.columnIndex || 0)).map((c) => c.content || '').filter(Boolean).join(' | '));
  });
  // Em PGDAS o layout costuma estar em tabela. O conteúdo integral e as
  // linhas de tabela complementam os parágrafos, sem perder o OCR original.
  // Prioriza linhas da tabela. O conteúdo integral pode juntar toda a página
  // numa só linha e, por isso, não é uma evidência segura para associar
  // rótulo e valor.
  const blocos = [...tabelas, ...paragrafos.map((p) => p.content), resultado?.analyzeResult?.content || ''].filter(Boolean);
  const texto = [...new Set(blocos)].join('\n');
  const localizacoes = paragrafos.map((p) => ({
    texto: p.content || '', pagina: p.boundingRegions?.[0]?.pageNumber || null,
    confianca: p.confidence ?? null,
  }));
  return { texto: texto || resultado?.analyzeResult?.content || '', localizacoes };
}

async function extrair(arquivo) {
  const cfg = config();
  if (!cfg.ativo) throw new Error('Azure Document Intelligence não configurado.');
  const iniciar = await requisitarComEspera(`${cfg.endpoint}/documentintelligence/documentModels/${cfg.modelo}:analyze?api-version=${cfg.versao}`, {
    method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': arquivo.mimetype || 'application/octet-stream' }, body: arquivo.buffer,
  });
  if (!iniciar.ok) throw new Error(`Azure Document Intelligence respondeu ${iniciar.status}.`);
  const operacao = iniciar.headers.get('operation-location');
  if (!operacao) throw new Error('Azure Document Intelligence não retornou operação de análise.');
  for (let tentativa = 0; tentativa < 45; tentativa++) {
    await espera(1000);
    const consulta = await requisitarComEspera(operacao, { headers: { 'Ocp-Apim-Subscription-Key': cfg.key } }, 'Consulta Azure Document Intelligence');
    if (!consulta.ok) throw new Error(`Consulta Azure Document Intelligence respondeu ${consulta.status}.`);
    const resultado = await consulta.json();
    if (resultado.status === 'succeeded') return { ...textoResultado(resultado), metodo: 'AZURE_DOCUMENT_INTELLIGENCE', modelo: cfg.modelo };
    if (resultado.status === 'failed') throw new Error('Azure Document Intelligence não conseguiu analisar o documento.');
  }
  throw new Error('Tempo esgotado na análise Azure Document Intelligence.');
}

module.exports = { config, diagnosticoSeguro, extrair };

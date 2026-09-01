/* Adaptador opcional do Azure Document Intelligence.
 * Credenciais ficam exclusivamente em variáveis de ambiente. O resultado é
 * somente leitura/OCR; a normalização continua a cargo da camada LLM Sattva.
 */
function config() {
  const endpoint = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').replace(/\/$/, '');
  const key = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '');
  return { endpoint, key, ativo: Boolean(endpoint && key), modelo: 'prebuilt-layout', versao: '2024-11-30' };
}

function espera(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function textoResultado(resultado) {
  const paragrafos = resultado?.analyzeResult?.paragraphs || [];
  const texto = paragrafos.map((p) => p.content).filter(Boolean).join('\n');
  const localizacoes = paragrafos.map((p) => ({
    texto: p.content || '', pagina: p.boundingRegions?.[0]?.pageNumber || null,
    confianca: p.confidence ?? null,
  }));
  return { texto: texto || resultado?.analyzeResult?.content || '', localizacoes };
}

async function extrair(arquivo) {
  const cfg = config();
  if (!cfg.ativo) throw new Error('Azure Document Intelligence não configurado.');
  const iniciar = await fetch(`${cfg.endpoint}/documentintelligence/documentModels/${cfg.modelo}:analyze?api-version=${cfg.versao}`, {
    method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': arquivo.mimetype || 'application/octet-stream' }, body: arquivo.buffer,
  });
  if (!iniciar.ok) throw new Error(`Azure Document Intelligence respondeu ${iniciar.status}.`);
  const operacao = iniciar.headers.get('operation-location');
  if (!operacao) throw new Error('Azure Document Intelligence não retornou operação de análise.');
  for (let tentativa = 0; tentativa < 45; tentativa++) {
    await espera(1000);
    const consulta = await fetch(operacao, { headers: { 'Ocp-Apim-Subscription-Key': cfg.key } });
    if (!consulta.ok) throw new Error(`Consulta Azure Document Intelligence respondeu ${consulta.status}.`);
    const resultado = await consulta.json();
    if (resultado.status === 'succeeded') return { ...textoResultado(resultado), metodo: 'AZURE_DOCUMENT_INTELLIGENCE', modelo: cfg.modelo };
    if (resultado.status === 'failed') throw new Error('Azure Document Intelligence não conseguiu analisar o documento.');
  }
  throw new Error('Tempo esgotado na análise Azure Document Intelligence.');
}

module.exports = { config, extrair };

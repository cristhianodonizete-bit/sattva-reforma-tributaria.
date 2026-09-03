/*
 * Telemetria leve de desempenho da API.
 *
 * Mantém apenas agregados de execução em memória: não persiste nem expõe
 * conteúdo de documentos, CNPJ, parâmetros fiscais ou dados de usuários.
 * Ao reiniciar a instância, a janela é naturalmente reiniciada.
 */
const LIMITE_AMOSTRAS = 2000;
const amostras = [];

function normalizarRota(rota = '') {
  return String(rota)
    .replace(/\/empresas\/\d+/g, '/empresas/:id')
    .replace(/\/(movimentos|contratos|turmas|participantes|combos|contratacoes|acoes)\/\d+/g, '/$1/:id')
    .replace(/\/qsa\/\d+/g, '/qsa/:id');
}

function numero(valor) {
  return Number.isFinite(Number(valor)) ? Number(valor) : 0;
}

function registrar({ metodo, rota, status, tempoMs, memoria }) {
  const amostra = {
    em: new Date().toISOString(),
    metodo: String(metodo || 'GET').toUpperCase(),
    rota: normalizarRota(rota),
    status: Number(status) || 0,
    tempo_ms: Math.max(0, Math.round(numero(tempoMs) * 100) / 100),
    heap_usado_mb: Math.round((numero(memoria?.heapUsed) / 1024 / 1024) * 100) / 100,
    rss_mb: Math.round((numero(memoria?.rss) / 1024 / 1024) * 100) / 100,
  };
  amostras.push(amostra);
  if (amostras.length > LIMITE_AMOSTRAS) amostras.splice(0, amostras.length - LIMITE_AMOSTRAS);
  return amostra;
}

function percentil(valores, p) {
  if (!valores.length) return 0;
  const posicao = Math.min(valores.length - 1, Math.max(0, Math.ceil(valores.length * p) - 1));
  return valores[posicao];
}

function resumo() {
  const porRota = new Map();
  for (const amostra of amostras) {
    const chave = `${amostra.metodo} ${amostra.rota}`;
    const grupo = porRota.get(chave) || [];
    grupo.push(amostra);
    porRota.set(chave, grupo);
  }
  const rotas = [...porRota.entries()].map(([rota, grupo]) => {
    const tempos = grupo.map((x) => x.tempo_ms).sort((a, b) => a - b);
    const ultimo = grupo[grupo.length - 1];
    return {
      rota,
      requisicoes: grupo.length,
      erros: grupo.filter((x) => x.status >= 400).length,
      lentas_acima_1s: grupo.filter((x) => x.tempo_ms >= 1000).length,
      media_ms: Math.round((tempos.reduce((s, x) => s + x, 0) / tempos.length) * 100) / 100,
      p50_ms: percentil(tempos, 0.5),
      p95_ms: percentil(tempos, 0.95),
      max_ms: tempos[tempos.length - 1],
      heap_ultimo_mb: ultimo.heap_usado_mb,
      rss_ultimo_mb: ultimo.rss_mb,
    };
  }).sort((a, b) => b.p95_ms - a.p95_ms || b.requisicoes - a.requisicoes);

  return {
    natureza: 'telemetria_volatil_de_leitura',
    inicio_janela: amostras[0]?.em || null,
    fim_janela: amostras[amostras.length - 1]?.em || null,
    total_requisicoes: amostras.length,
    capacidade_maxima: LIMITE_AMOSTRAS,
    rotas,
  };
}

function limparParaTeste() { amostras.splice(0, amostras.length); }

module.exports = { registrar, resumo, normalizarRota, limparParaTeste };

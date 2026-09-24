/*
 * Telemetria leve de desempenho da API.
 *
 * Mantém apenas agregados de execução em memória: não persiste nem expõe
 * conteúdo de documentos, CNPJ, parâmetros fiscais ou dados de usuários.
 * Ao reiniciar a instância, a janela é naturalmente reiniciada.
 */
const LIMITE_AMOSTRAS = 2000;
const amostras = [];
// A persistência remota é somente observabilidade. Manter uma fila separada
// impede que o resumo inteiro da instância seja inserido de novo a cada
// minuto — comportamento que multiplicava linhas e tráfego sem acrescentar
// qualquer nova medição.
const amostrasPendentes = [];
let ultimaPersistencia = 0;
let persistindo = null;

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
  amostrasPendentes.push(amostra);
  if (amostras.length > LIMITE_AMOSTRAS) amostras.splice(0, amostras.length - LIMITE_AMOSTRAS);
  if (amostrasPendentes.length > LIMITE_AMOSTRAS) amostrasPendentes.splice(0, amostrasPendentes.length - LIMITE_AMOSTRAS);
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

function resumirAmostras(amostrasDaJanela) {
  const porRota = new Map();
  for (const amostra of amostrasDaJanela) {
    const chave = `${amostra.metodo} ${amostra.rota}`;
    const grupo = porRota.get(chave) || [];
    grupo.push(amostra);
    porRota.set(chave, grupo);
  }
  return {
    inicio_janela: amostrasDaJanela[0]?.em || null,
    fim_janela: amostrasDaJanela[amostrasDaJanela.length - 1]?.em || null,
    rotas: [...porRota.entries()].map(([rota, grupo]) => {
      const tempos = grupo.map((x) => x.tempo_ms).sort((a, b) => a - b);
      const ultimo = grupo[grupo.length - 1];
      return {
        rota, requisicoes: grupo.length,
        erros: grupo.filter((x) => x.status >= 400).length,
        lentas_acima_1s: grupo.filter((x) => x.tempo_ms >= 1000).length,
        media_ms: Math.round((tempos.reduce((s, x) => s + x, 0) / tempos.length) * 100) / 100,
        p50_ms: percentil(tempos, 0.5), p95_ms: percentil(tempos, 0.95), max_ms: tempos[tempos.length - 1],
        heap_ultimo_mb: ultimo.heap_usado_mb, rss_ultimo_mb: ultimo.rss_mb,
      };
    }),
  };
}

function limparParaTeste() { amostras.splice(0, amostras.length); amostrasPendentes.splice(0, amostrasPendentes.length); }

async function persistir(remoto, intervaloMs = 60000) {
  if (!remoto || !amostrasPendentes.length || persistindo || Date.now() - ultimaPersistencia < intervaloMs) return false;
  const pendentesNestaRodada = amostrasPendentes.slice();
  const resumoAtual = resumirAmostras(pendentesNestaRodada);
  const linhas = resumoAtual.rotas.map((r) => ({
    janela_inicio: resumoAtual.inicio_janela, janela_fim: resumoAtual.fim_janela, rota: r.rota,
    requisicoes: r.requisicoes, erros: r.erros, lentas_acima_1s: r.lentas_acima_1s,
    media_ms: r.media_ms, p50_ms: r.p50_ms, p95_ms: r.p95_ms, max_ms: r.max_ms,
    heap_ultimo_mb: r.heap_ultimo_mb, rss_ultimo_mb: r.rss_ultimo_mb,
  }));
  persistindo = remoto.from('telemetria_performance_http').insert(linhas).then(({ error }) => {
    if (error) throw error;
    // A persistência é serializada por `persistindo`; portanto, somente as
    // amostras incluídas nesta gravação saem da fila. As que chegaram durante
    // a requisição permanecem para a próxima janela.
    amostrasPendentes.splice(0, pendentesNestaRodada.length);
    ultimaPersistencia = Date.now();
    return true;
  }).finally(() => { persistindo = null; });
  return persistindo;
}

module.exports = { registrar, resumo, normalizarRota, limparParaTeste, persistir };

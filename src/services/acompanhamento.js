/* Acompanhamento: consolida fotografias já calculadas. Não chama motor fiscal. */
const METRICAS = ['receita','compras','preco_medio','base_economica','ibs','cbs','credito_ibs','credito_cbs','carga_liquida','custo_efetivo','margem','caixa','credito_entregue','cobertura_cadastral','classificacao_pendente'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function json(v, padrao = {}) { try { return v ? JSON.parse(v) : padrao; } catch (_) { return padrao; } }
function stringify(v) { return JSON.stringify(v || {}); }

function indicadoresPerfil(perfis) {
  const p = perfis || [];
  if (!p.length) return Object.fromEntries(METRICAS.map((m) => [m, null]));
  const soma = (k) => p.reduce((n, x) => n + (Number(x[k]) || 0), 0);
  const receita = soma('receita_bruta'), compras = soma('compras_brutas');
  return {
    receita, compras,
    base_economica: soma('base_economica_saidas'),
    ibs: 0, cbs: soma('cbs_debito'), credito_ibs: 0, credito_cbs: soma('cbs_credito'),
    carga_liquida: soma('cbs_liquida'), credito_entregue: soma('cbs_debito'),
    preco_medio: null, custo_efetivo: null, margem: null, caixa: null,
    cobertura_cadastral: receita ? soma('cobertura_classificacao_cbs') / p.length : null,
    classificacao_pendente: soma('receita_tratamento_indeterminado_cbs'),
  };
}

function tipoDesvio(metrica, previsto, realizado) {
  if (metrica === 'classificacao_pendente' || metrica === 'cobertura_cadastral') return 'DESVIO_DE_DADOS';
  if (['credito_cbs','credito_ibs','cbs','ibs','carga_liquida','base_economica'].includes(metrica)) return 'DESVIO_FISCAL';
  if (['margem','caixa','custo_efetivo','preco_medio','receita','compras'].includes(metrica)) return 'DESVIO_ECONOMICO';
  return 'DESVIO_DE_PREMISSA';
}
function comparar(baseline, snapshot) {
  const esperado = json(baseline.indicadores_aprovados), realizado = json(snapshot.indicadores_realizados);
  const desvios = [];
  for (const metrica of METRICAS) {
    const a = esperado[metrica], b = realizado[metrica];
    if (a === null || a === undefined || b === null || b === undefined) {
      desvios.push({ metrica, tipo: 'DESVIO_DE_DADOS', baseline_valor: a ?? null, realizado_valor: b ?? null, diferenca_absoluta: null, diferenca_percentual: null, status: 'INCOMPLETO', causa: 'Dado previsto ou realizado não disponível.', evidencia: 'Fotografia preserva ausência de dado; não foi convertido em zero.', acao_sugerida: 'Completar a evidência antes de concluir o desvio.', natureza: 'INDETERMINADO' });
      continue;
    }
    const dif = r2(b - a), pct = a === 0 ? null : r2(dif / Math.abs(a));
    desvios.push({ metrica, tipo: tipoDesvio(metrica, a, b), baseline_valor: a, realizado_valor: b, diferenca_absoluta: dif, diferenca_percentual: pct, status: Math.abs(dif) < 0.005 ? 'SEM_DESVIO' : 'DIVERGENTE', causa: Math.abs(dif) < 0.005 ? 'Resultado realizado compatível com o baseline.' : 'Desvio verificável entre fotografia aprovada e realizada.', evidencia: `Baseline ${baseline.id} × fotografia ${snapshot.id}.`, acao_sugerida: Math.abs(dif) < 0.005 ? null : 'Validar a causa e registrar ação corretiva.', natureza: snapshot.natureza === 'REAL' ? 'CALCULADO' : snapshot.natureza });
  }
  const divergentes = desvios.filter((x) => x.status === 'DIVERGENTE').length;
  const incompletos = desvios.filter((x) => x.status === 'INCOMPLETO').length;
  return { status: incompletos ? 'INCOMPLETO' : divergentes ? 'DIVERGENTE' : 'RECONCILIADO', desvios };
}
function memoria(baseline, snapshot, desvio) {
  return { baseline: { id: baseline.id, versao: baseline.versao, natureza: baseline.natureza, origem: baseline.origem }, realizado: { id: snapshot.id, periodo: snapshot.periodo, natureza: snapshot.natureza, origem: snapshot.origem }, metrica: desvio.metrica, valor_previsto: desvio.baseline_valor, valor_realizado: desvio.realizado_valor, diferenca: desvio.diferenca_absoluta, evidencia: desvio.evidencia };
}
function prioridade(desvio) {
  if (desvio.status === 'INCOMPLETO') return 'MEDIA';
  if (['DESVIO_FISCAL','DESVIO_ECONOMICO'].includes(desvio.tipo)) return 'ALTA';
  return 'MEDIA';
}
function textoAlerta(desvio) {
  const nome = ({ credito_cbs: 'O crédito CBS realizado', margem: 'A margem realizada', classificacao_pendente: 'As classificações pendentes', compras: 'As compras realizadas', receita: 'A receita realizada' })[desvio.metrica] || `A métrica ${desvio.metrica}`;
  if (desvio.status === 'INCOMPLETO') return `${nome} não pode ser concluído porque falta dado previsto ou realizado.`;
  const unidade = ['margem','cobertura_cadastral'].includes(desvio.metrica) ? ' p.p.' : '';
  return `${nome} divergiu do baseline: previsto ${desvio.baseline_valor}, realizado ${desvio.realizado_valor}, diferença ${desvio.diferenca_absoluta}${unidade}.`;
}
function alerta(desvio) {
  if (!desvio?.evidencia || !['DIVERGENTE','INCOMPLETO'].includes(desvio.status)) return null;
  return { titulo: desvio.tipo.replaceAll('_',' '), mensagem: textoAlerta(desvio), prioridade: prioridade(desvio), impacto: desvio.acao_sugerida || 'Validar causa antes de alterar a estratégia.', evidencia: desvio.evidencia, natureza: desvio.natureza || 'CALCULADO' };
}
function aderencia(desvios, acoes) {
  const lista = desvios || [], tarefas = acoes || [];
  if (!lista.length || lista.some((x) => x.status === 'INCOMPLETO')) return { status: 'INCOMPLETO', valor: null, formula: 'INCOMPLETO: há métricas sem baseline ou realizado suficiente.' };
  const relevantes = lista.filter((x) => x.status !== 'INCOMPLETO');
  const concluidas = new Set(tarefas.filter((x) => x.status === 'CONCLUIDA').map((x) => Number(x.desvio_id)));
  const cumpridos = relevantes.filter((x) => x.status === 'SEM_DESVIO' || concluidas.has(Number(x.id))).length;
  const valor = relevantes.length ? r2(cumpridos / relevantes.length) : null;
  return { status: valor === 1 ? 'ADERENTE' : 'EM_ACAO', valor, formula: '(métricas sem desvio + desvios com ação concluída) ÷ métricas com dados completos' };
}
module.exports = { METRICAS, json, stringify, indicadoresPerfil, comparar, memoria, alerta, aderencia };

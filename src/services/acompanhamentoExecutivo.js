/** Saída executiva de Acompanhamento: leitura de fatos persistidos, sem motores. */
const PDFDocument = require('pdfkit');

const n = (v) => Number(v) || 0;
const data = (v) => String(v || '');
const moeda = (v) => v === null || v === undefined ? 'INDETERMINADO' : `R$ ${n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percentual = (v) => v === null || v === undefined ? 'INDETERMINADO' : `${(n(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const json = (v, padrao = {}) => { try { return v ? JSON.parse(v) : padrao; } catch (_) { return padrao; } };
const hoje = () => new Date().toISOString().slice(0, 10);

function prioridade(desvio) {
  if (desvio.status === 'INCOMPLETO') return 'MEDIA';
  return ['DESVIO_FISCAL', 'DESVIO_ECONOMICO'].includes(desvio.tipo) ? 'ALTA' : 'MEDIA';
}
function statusAcao(acao, referencia = hoje()) {
  if (acao.status === 'CONCLUIDA' || acao.status === 'CANCELADA') return acao.status;
  return acao.prazo && acao.prazo < referencia ? 'ATRASADA' : acao.status;
}
function montar({ empresaId, baselines = [], snapshots = [], comparacoes = [], desvios = [], alertas = [], acoes = [] }, opcoes = {}) {
  const ordenadasBase = [...baselines].sort((a, b) => Number(b.versao) - Number(a.versao));
  const ordenadasFotos = [...snapshots].sort((a, b) => data(b.periodo).localeCompare(data(a.periodo)) || Number(b.id) - Number(a.id));
  const baseline = opcoes.baseline_id ? baselines.find((x) => Number(x.id) === Number(opcoes.baseline_id)) : ordenadasBase[0] || null;
  const snapshot = opcoes.snapshot_id ? snapshots.find((x) => Number(x.id) === Number(opcoes.snapshot_id)) : ordenadasFotos[0] || null;
  const comparacao = (baseline && snapshot && comparacoes.find((x) => Number(x.baseline_id) === Number(baseline.id) && Number(x.snapshot_id) === Number(snapshot.id)))
    || (snapshot && comparacoes.find((x) => Number(x.snapshot_id) === Number(snapshot.id))) || null;
  const selecionados = comparacao ? desvios.filter((x) => Number(x.comparison_id) === Number(comparacao.id)) : [];
  const acoesComStatus = acoes.map((x) => ({ ...x, status_executivo: statusAcao(x, opcoes.data_referencia) }));
  const acoesPorDesvio = new Map();
  acoesComStatus.forEach((x) => { const lista = acoesPorDesvio.get(Number(x.desvio_id)) || []; lista.push(x); acoesPorDesvio.set(Number(x.desvio_id), lista); });
  const previstoRealizado = selecionados.map((x) => ({
    metrica: x.metrica, baseline: x.baseline_valor, realizado: x.realizado_valor,
    diferenca_absoluta: x.diferenca_absoluta, diferenca_percentual: x.diferenca_percentual,
    status: x.status, tipo: x.tipo, prioridade: prioridade(x), causa: x.causa,
    evidencia: x.evidencia, natureza: x.natureza, desvio_id: x.id,
    acoes: acoesPorDesvio.get(Number(x.id)) || [], memoria: json(x.memoria),
  }));
  const porTipo = Object.fromEntries(['DESVIO_DE_PREMISSA', 'DESVIO_FISCAL', 'DESVIO_ECONOMICO', 'DESVIO_DE_DADOS'].map((tipo) => [tipo, selecionados.filter((x) => x.tipo === tipo && x.status !== 'SEM_DESVIO').length]));
  const porPrioridade = Object.fromEntries(['ALTA', 'MEDIA', 'BAIXA'].map((p) => [p, selecionados.filter((x) => x.status !== 'SEM_DESVIO' && prioridade(x) === p).length]));
  const indicadores = {
    desvios_totais: selecionados.filter((x) => x.status !== 'SEM_DESVIO').length,
    desvios_por_tipo: porTipo, desvios_por_prioridade: porPrioridade,
    acoes_abertas: acoesComStatus.filter((x) => x.status_executivo === 'ABERTA').length,
    acoes_em_andamento: acoesComStatus.filter((x) => x.status_executivo === 'EM_ANDAMENTO').length,
    acoes_atrasadas: acoesComStatus.filter((x) => x.status_executivo === 'ATRASADA').length,
    acoes_concluidas: acoesComStatus.filter((x) => x.status_executivo === 'CONCLUIDA').length,
    cobertura_dados: snapshot ? (json(snapshot.cobertura_dados, null) ?? json(snapshot.indicadores_realizados).cobertura_cadastral ?? null) : null,
    aderencia: opcoes.aderencia || { status: 'INCOMPLETO', valor: null, formula: 'Sem comparação persistida.' },
  };
  const evolucao = [...snapshots].sort((a, b) => data(a.periodo).localeCompare(data(b.periodo))).map((s) => {
    const c = comparacoes.find((x) => Number(x.snapshot_id) === Number(s.id) && (!baseline || Number(x.baseline_id) === Number(baseline.id))) || null;
    const ds = c ? desvios.filter((x) => Number(x.comparison_id) === Number(c.id)) : [];
    const indicadoresSnapshot = json(s.indicadores_realizados);
    return { periodo: s.periodo, snapshot_id: s.id, origem: s.origem, natureza: s.natureza, comparison_id: c?.id || null, status: c?.status || 'SEM_COMPARACAO',
      aderencia: c?.status === 'RECONCILIADO' ? 1 : c?.status === 'INCOMPLETO' || !c ? null : 0,
      cbs: indicadoresSnapshot.cbs ?? null, credito_cbs: indicadoresSnapshot.credito_cbs ?? null, margem: indicadoresSnapshot.margem ?? null,
      custo_efetivo: indicadoresSnapshot.custo_efetivo ?? null, cobertura: indicadoresSnapshot.cobertura_cadastral ?? null,
      desvios: ds.filter((x) => x.status !== 'SEM_DESVIO').length, acoes_concluidas: acoesComStatus.filter((x) => ds.some((d) => Number(d.id) === Number(x.desvio_id)) && x.status_executivo === 'CONCLUIDA').length,
    };
  });
  const cronologia = [
    ...baselines.map((x) => ({ tipo: 'BASELINE', data: x.data_aprovacao, descricao: `Baseline V${x.versao} aprovado`, id: x.id, natureza: x.natureza })),
    ...snapshots.map((x) => ({ tipo: 'SNAPSHOT', data: x.periodo, descricao: `Fotografia realizada: ${x.periodo}`, id: x.id, natureza: x.natureza })),
    ...selecionados.filter((x) => x.status !== 'SEM_DESVIO').map((x) => ({ tipo: 'DESVIO', data: snapshot?.periodo || '', descricao: `${x.metrica}: ${x.status}`, id: x.id, natureza: x.natureza })),
    ...acoesComStatus.map((x) => ({ tipo: 'ACAO', data: x.atualizado_em || x.criado_em || '', descricao: `${x.acao} (${x.status_executivo})`, id: x.id, natureza: 'INTERPRETADO' })),
  ].sort((a, b) => data(a.data).localeCompare(data(b.data)) || Number(a.id) - Number(b.id));
  return { empresa_id: empresaId, baseline, snapshot, comparacao, indicadores, previsto_realizado: previstoRealizado, acoes: acoesComStatus, alertas, evolucao, cronologia,
    limitacoes: previstoRealizado.filter((x) => x.status === 'INCOMPLETO' || x.natureza === 'INDETERMINADO'),
    memoria: { tipo: 'ACOMPANHAMENTO_EXECUTIVO', fontes: ['monitoring_baselines', 'monitoring_snapshots', 'monitoring_comparisons', 'monitoring_deviations', 'monitoring_actions'], regra: 'Leitura de resultados persistidos; não recalcula motores nem altera baseline.' },
  };
}
function linha(doc, texto, natureza) { doc.fontSize(9).fillColor('#202020').text(texto); if (natureza) doc.fontSize(7).fillColor('#6a6a6a').text(`Natureza: ${natureza}`); doc.moveDown(.35); }
function gerarPdf(relatorio, destino, { consolidado = false } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: consolidado ? 'Acompanhamento consolidado - Sattva' : 'Acompanhamento por período - Sattva' } }); doc.pipe(destino);
  doc.fontSize(18).fillColor('#073b5c').text(consolidado ? 'Acompanhamento — relatório consolidado' : 'Acompanhamento — relatório do período'); doc.moveDown();
  linha(doc, `Baseline: ${relatorio.baseline ? `V${relatorio.baseline.versao}` : 'INDETERMINADO'} | Período: ${relatorio.snapshot?.periodo || 'INDETERMINADO'}`, relatorio.baseline?.natureza || 'INDETERMINADO');
  doc.fontSize(13).fillColor('#073b5c').text('Resumo executivo');
  linha(doc, `Aderência: ${relatorio.indicadores.aderencia.valor == null ? 'INCOMPLETO' : percentual(relatorio.indicadores.aderencia.valor)} (${relatorio.indicadores.aderencia.status})`);
  linha(doc, `Desvios: ${relatorio.indicadores.desvios_totais} | Ações abertas: ${relatorio.indicadores.acoes_abertas} | Em andamento: ${relatorio.indicadores.acoes_em_andamento} | Atrasadas: ${relatorio.indicadores.acoes_atrasadas} | Concluídas: ${relatorio.indicadores.acoes_concluidas}`);
  linha(doc, `Cobertura dos dados: ${relatorio.indicadores.cobertura_dados == null ? 'INDETERMINADO' : percentual(relatorio.indicadores.cobertura_dados)}`);
  doc.addPage().fontSize(13).fillColor('#073b5c').text('Previsto × realizado');
  (relatorio.previsto_realizado.length ? relatorio.previsto_realizado : [{ metrica: 'Sem comparação persistida.', status: 'INCOMPLETO', natureza: 'INDETERMINADO' }]).forEach((x) => linha(doc, `${x.metrica}: previsto ${moeda(x.baseline)} | realizado ${moeda(x.realizado)} | diferença ${moeda(x.diferenca_absoluta)} | ${x.diferenca_percentual == null ? 'INDETERMINADO' : percentual(x.diferenca_percentual)} | ${x.status}. Causa: ${x.causa || 'INDETERMINADA'}. Evidência: ${x.evidencia || 'INDETERMINADA'}.`, x.natureza));
  doc.addPage().fontSize(13).fillColor('#073b5c').text('Ações corretivas e pendências');
  (relatorio.acoes.length ? relatorio.acoes : [{ acao: 'Nenhuma ação corretiva registrada.', status_executivo: 'INDETERMINADO', evidencia: '—', natureza: 'INDETERMINADO' }]).forEach((x) => linha(doc, `${x.acao} | responsável: ${x.responsavel || '—'} | prazo: ${x.prazo || '—'} | prioridade: ${x.prioridade || '—'} | status: ${x.status_executivo}. Evidência: ${x.evidencia || '—'}`, x.natureza || 'INTERPRETADO'));
  doc.addPage().fontSize(13).fillColor('#073b5c').text('Histórico e memória');
  relatorio.cronologia.forEach((x) => linha(doc, `${x.data || 'sem data'} — ${x.descricao}`, x.natureza));
  linha(doc, 'Regra: execução diferente do plano registra desvio; uma nova estratégia exige baseline explícito.', 'CALCULADO');
  doc.end();
}
module.exports = { montar, gerarPdf, statusAcao };

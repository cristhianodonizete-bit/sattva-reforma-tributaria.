/** Saída executiva de Contratos — somente consolida fatos já persistidos. */
const PDFDocument = require('pdfkit');

const n = (v) => Number(v) || 0;
const moeda = (v) => v == null ? 'INDETERMINADO' : `R$ ${n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function naturezaContrato(contrato) {
  const v = String(contrato.natureza_contrato || '').trim().toUpperCase();
  // A natureza é uma conclusão de cadastro/documento, nunca uma inferência
  // por tipo, valor ou contraparte. Sem fonte explícita, permanece pendente.
  if (!String(contrato.natureza_contrato_evidencia || '').trim()) return 'INDETERMINADO';
  if (['CONTRATO_ADMINISTRATIVO', 'ADMINISTRATIVO'].includes(v)) return 'CONTRATO_ADMINISTRATIVO';
  if (['CONTRATO_PRIVADO', 'PRIVADO'].includes(v)) return 'CONTRATO_PRIVADO';
  return 'INDETERMINADO';
}

function estadoEconomico(item) {
  if (!item) return 'INDETERMINADO';
  if (item.status === 'INCOMPLETO' || item.simulacao?.status === 'INCOMPLETO') return 'INCOMPLETO';
  if (item.simulacao?.natureza === 'SIMULADO') return 'SIMULADO';
  if (item.simulacao?.natureza === 'INDETERMINADO' || item.simulacao?.preco_projetado == null) return 'INDETERMINADO';
  return item.simulacao?.natureza || 'CALCULADO';
}

function impactoEconomico(item, vinculo) {
  const s = item.simulacao || {};
  return {
    vinculo_id: vinculo.id, tipo_item: vinculo.tipo_item, item_id: vinculo.item_precificacao_id,
    fotografia_id: vinculo.pricing_simulacao_id, descricao: item.item?.descricao || 'Item vinculado',
    preco_atual: s.valor_venda_atual, preco_projetado: s.preco_projetado,
    margem_atual: s.margem_atual, margem_projetada: s.margem_projetada,
    custo_formado: item.custos?.custo_formado, credito_entregue: s.credito_entregue_ao_cliente,
    custo_efetivo_cliente: s.custo_efetivo_do_cliente,
    necessidade_reajuste: s.valor_venda_atual != null && s.preco_projetado != null && n(s.preco_projetado) > n(s.valor_venda_atual),
    natureza: estadoEconomico(item), origem: 'PRECIFICACAO_VINCULO_EXPLICITO', memoria: item.waterfall || null,
  };
}

function alerta(r) { return { contrato_id: r.contrato.id, contrato: r.contrato.nome || r.contrato.contraparte || `Contrato #${r.contrato.id}`, ...r }; }

function montarContrato({ contrato, documentos = [], clausulas = [], riscos = [], recomendacoes = [], sugestoes = [], impactosEconomicos = [] }) {
  const natureza = naturezaContrato(contrato);
  const pendencias = [];
  if (natureza === 'INDETERMINADO') pendencias.push({ natureza: 'INDETERMINADO', texto: 'A natureza do contrato não foi definida. Não há conclusão jurídica específica sobre reequilíbrio administrativo.' });
  documentos.filter((d) => d.status_extracao !== 'CONCLUIDA').forEach((d) => pendencias.push({ natureza: 'INDETERMINADO', texto: `Documento ${d.nome_original}: ${d.observacao_extracao || d.status_extracao}.` }));
  impactosEconomicos.filter((x) => ['INDETERMINADO', 'INCOMPLETO'].includes(x.natureza)).forEach((x) => pendencias.push({ natureza: x.natureza, texto: `Fotografia vinculada de ${x.descricao}: ${x.natureza}.` }));
  const alertas = [];
  for (const r of riscos) {
    const texto = {
      PRECO_FIXO_SEM_REVISAO: 'possui preço fixo e não foi identificada cláusula de revisão por alteração tributária.',
      TRIBUTOS_LEGADOS_SEM_TRANSICAO: 'contém referência a PIS/COFINS, ICMS ou ISS sem tratamento identificado para a transição.',
      AUSENCIA_CLAUSULA_TRIBUTARIA: 'não possui cláusula tributária identificada na triagem.',
      CLAUSULA_TRIBUTARIA_GENERICA: 'possui cláusula tributária potencialmente genérica.',
      POTENCIAL_ABSORCAO_AUMENTO: 'possui potencial de absorção tributária sem mecanismo identificado.',
      RETENCOES_SEM_RESPONSABILIDADE: 'menciona retenções sem responsabilidade correlata identificada.',
      RESPONSABILIDADE_TRIBUTARIA_INDEFINIDA: 'não possui responsabilidade tributária claramente identificada.',
    }[r.codigo];
    if (texto) alertas.push(alerta({ contrato, codigo: r.codigo, nivel: r.nivel, texto: `${contrato.nome || contrato.contraparte || 'Contrato'} ${texto}`, evidencia: r.evidencia, clausula_id: r.clausula_id || null, natureza: 'INTERPRETADO' }));
  }
  for (const e of impactosEconomicos) {
    if (e.necessidade_reajuste || (e.margem_atual != null && e.margem_projetada != null && n(e.margem_projetada) < n(e.margem_atual))) alertas.push(alerta({ contrato, codigo: 'IMPACTO_ECONOMICO_VINCULADO', nivel: 'alto', texto: `${contrato.nome || contrato.contraparte || 'Contrato'} possui impacto econômico na fotografia vinculada: preço atual ${moeda(e.preco_atual)}, preço projetado ${moeda(e.preco_projetado)}.`, evidencia: `Item ${e.descricao}; fotografia #${e.fotografia_id}; origem explícita.`, clausula_id: null, natureza: e.natureza }));
  }
  const parecer = {
    ressalva: 'Parecer técnico informativo: não substitui revisão jurídica, não altera o contrato e não conclui além das evidências registradas.',
    natureza_contrato: natureza,
    administrativo: natureza === 'CONTRATO_ADMINISTRATIVO'
      ? 'Contrato marcado como administrativo. A análise específica de carga tributária, não cumulatividade, créditos, repasse, transição e comprovação do desequilíbrio depende das evidências do caso e de revisão jurídica aplicável.'
      : natureza === 'CONTRATO_PRIVADO'
        ? 'Contrato marcado como privado. A análise limita-se às cláusulas, evidências extraídas, resultados econômicos vinculados e fundamentos identificados.'
        : 'Natureza contratual indeterminada: não é emitida conclusão jurídica específica sobre reequilíbrio administrativo.',
    secoes: [
      { tipo: 'FATO', natureza: 'EXTRAIDO', texto: `${documentos.length} documento(s) preservado(s) e ${clausulas.length} cláusula(s)/trecho(s) extraído(s).` },
      { tipo: 'INTERPRETACAO', natureza: 'INTERPRETADO', texto: `${riscos.length} risco(s) identificado(s) a partir de trecho fonte ou ausência objetiva.` },
      ...impactosEconomicos.map((e) => ({ tipo: 'CALCULO', natureza: e.natureza, texto: `${e.descricao}: preço ${moeda(e.preco_atual)} → ${moeda(e.preco_projetado)}; margem ${moeda(e.margem_atual)} → ${moeda(e.margem_projetada)}.` })),
      ...sugestoes.map((s) => ({ tipo: 'SUGESTAO', natureza: 'SUGERIDO', texto: `Rascunho: ${s.motivo}` })),
      ...pendencias.map((p) => ({ tipo: 'PENDENCIA', natureza: p.natureza, texto: p.texto })),
    ],
  };
  return { contrato: { ...contrato, natureza_contrato: natureza }, documentos, clausulas, riscos, impactos_economicos: impactosEconomicos, recomendacoes, sugestoes, pendencias, alertas, parecer };
}

function painel(relatorios) {
  const ids = (f) => [...new Set(relatorios.filter(f).map((r) => r.contrato.id))];
  const risco = (nivel) => ids((r) => r.riscos.some((x) => x.nivel === nivel));
  const codigo = (c) => ids((r) => r.riscos.some((x) => x.codigo === c));
  const indicador = (lista) => ({ quantidade: lista.length, contratos: lista });
  return {
    contratos_analisados: indicador(ids((r) => r.documentos.length > 0)),
    contratos_administrativos: indicador(ids((r) => r.contrato.natureza_contrato === 'CONTRATO_ADMINISTRATIVO')),
    contratos_privados: indicador(ids((r) => r.contrato.natureza_contrato === 'CONTRATO_PRIVADO')),
    contratos_indeterminados: indicador(ids((r) => r.contrato.natureza_contrato === 'INDETERMINADO')),
    risco_alto: indicador(risco('alto')), risco_medio: indicador(risco('medio')), risco_baixo: indicador(risco('baixo')),
    sem_clausula_tributaria: indicador(codigo('AUSENCIA_CLAUSULA_TRIBUTARIA')),
    preco_fixo_sem_revisao: indicador(codigo('PRECO_FIXO_SEM_REVISAO')),
    risco_margem: indicador(ids((r) => r.impactos_economicos.some((x) => x.margem_atual != null && x.margem_projetada != null && n(x.margem_projetada) < n(x.margem_atual)))),
    risco_transicao: indicador(codigo('TRIBUTOS_LEGADOS_SEM_TRANSICAO')),
    risco_repasse: indicador(codigo('POTENCIAL_ABSORCAO_AUMENTO')),
    risco_retencoes: indicador(codigo('RETENCOES_SEM_RESPONSABILIDADE')),
    risco_responsabilidade_tributaria: indicador(codigo('RESPONSABILIDADE_TRIBUTARIA_INDEFINIDA')),
    contratos_vinculados_precificacao: indicador(ids((r) => r.impactos_economicos.length > 0)),
    contratos_incompletos: indicador(ids((r) => r.pendencias.length > 0)),
  };
}

function linha(doc, titulo, texto, etiqueta = '') {
  doc.fontSize(12).fillColor('#073b5c').text(titulo); doc.moveDown(.2); doc.fontSize(9).fillColor('#222').text(`${etiqueta ? `[${etiqueta}] ` : ''}${texto}`); doc.moveDown(.6);
}
function gerarPdfIndividual(relatorio, destino) {
  const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: 'Relatório contratual - Sattva' } }); doc.pipe(destino);
  doc.fontSize(18).fillColor('#073b5c').text('Relatório contratual'); doc.fontSize(9).fillColor('#666').text('Sattva · Documento executivo rastreável'); doc.moveDown();
  linha(doc, '1. Identificação', `${relatorio.contrato.nome || 'Contrato'} · status: ${relatorio.contrato.status_analise || 'NÃO INICIADA'}`, 'EXTRAIDO');
  linha(doc, '2. Objeto', relatorio.contrato.objeto || 'Não informado.', 'EXTRAIDO');
  linha(doc, '3. Contraparte', relatorio.contrato.contraparte || 'Não informada.', 'EXTRAIDO');
  linha(doc, '4. Vigência', `${relatorio.contrato.vigencia_inicio || 'não informada'} → ${relatorio.contrato.vigencia_fim || 'não informada'}`, 'EXTRAIDO');
  linha(doc, '5. Natureza do contrato', relatorio.parecer.administrativo, relatorio.contrato.natureza_contrato === 'INDETERMINADO' ? 'INDETERMINADO' : 'INTERPRETADO');
  linha(doc, '6. Cláusulas relevantes extraídas', relatorio.clausulas.length ? relatorio.clausulas.map((c) => `${c.localizacao}: ${c.texto_original}`).join('\n\n') : 'Nenhuma cláusula temática extraída.', 'EXTRAIDO');
  linha(doc, '7. Riscos identificados', relatorio.riscos.length ? relatorio.riscos.map((r) => `${r.risco} (${String(r.nivel).toUpperCase()}) — ${r.evidencia}`).join('\n\n') : 'Nenhum risco inicial registrado.', 'INTERPRETADO');
  linha(doc, '8. Impactos econômicos vinculados', relatorio.impactos_economicos.length ? relatorio.impactos_economicos.map((e) => `${e.descricao}: preço ${moeda(e.preco_atual)} → ${moeda(e.preco_projetado)}; margem ${moeda(e.margem_atual)} → ${moeda(e.margem_projetada)}; crédito entregue ${moeda(e.credito_entregue)}; custo efetivo ${moeda(e.custo_efetivo_cliente)}.`).join('\n') : 'Sem vínculo explícito confirmado com fotografia de Precificação.', 'CALCULADO');
  linha(doc, '9. Recomendações', relatorio.recomendacoes.length ? relatorio.recomendacoes.map((r) => `${r.prioridade}: ${r.recomendacao}\nEvidência: ${r.evidencia}`).join('\n\n') : 'Nenhuma recomendação sustentada disponível.', 'INTERPRETADO');
  linha(doc, '10. Sugestões de redação', relatorio.sugestoes.length ? relatorio.sugestoes.map((s) => `TEXTO ORIGINAL: ${s.clausula_original || 'Ausência objetiva'}\nRASCUNHO SUGERIDO: ${s.sugestao_redacao}\nMOTIVO: ${s.motivo}\nFUNDAMENTO: ${s.fundamento}`).join('\n\n') : 'Nenhum rascunho sugerido.', 'SUGERIDO / RASCUNHO');
  linha(doc, '11. Pontos que dependem de validação', relatorio.pendencias.length ? relatorio.pendencias.map((p) => p.texto).join('\n') : 'Sem pendência registrada nesta fotografia.', 'INDETERMINADO');
  linha(doc, '12. Fundamentos', relatorio.riscos.length ? relatorio.riscos.map((r) => r.fundamento).filter((x, i, a) => a.indexOf(x) === i).join('\n') : 'Fundamentos não aplicáveis.', 'INTERPRETADO');
  linha(doc, '13. Memória e evidências', relatorio.parecer.ressalva, 'MEMÓRIA'); doc.end();
}
function gerarPdfCarteira({ painel: p, relatorios }, destino) {
  const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: 'Carteira contratual - Sattva' } }); doc.pipe(destino);
  doc.fontSize(18).fillColor('#073b5c').text('Carteira contratual — painel executivo'); doc.moveDown();
  Object.entries(p).forEach(([k, v]) => doc.fontSize(9).fillColor('#222').text(`${k.replaceAll('_', ' ')}: ${v.quantidade}`));
  doc.addPage().fontSize(14).fillColor('#073b5c').text('Alertas e contratos');
  relatorios.forEach((r) => { doc.moveDown(.4).fontSize(10).fillColor('#222').text(`${r.contrato.nome || r.contrato.contraparte || `Contrato #${r.contrato.id}`} [${r.contrato.natureza_contrato}]`); (r.alertas.length ? r.alertas : [{ texto: 'Sem alerta objetivo nesta fotografia.', natureza: 'INDETERMINADO' }]).forEach((a) => doc.fontSize(8).text(`[${a.natureza}] ${a.texto}`)); }); doc.end();
}

module.exports = { naturezaContrato, impactoEconomico, montarContrato, painel, gerarPdfIndividual, gerarPdfCarteira };

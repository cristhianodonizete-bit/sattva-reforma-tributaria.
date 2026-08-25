/**
 * MÓDULO 2 — PRECIFICAÇÃO COMERCIAL OFICIAL
 *
 * Esta camada não calcula tributos. Base econômica, CBS, IBS, crédito,
 * tratamento, CST e cClassTrib são fatos recebidos de motor_resultados.
 * A responsabilidade deste arquivo começa depois do motor fiscal: formar
 * custo econômico explícito, medir margem e indicar preço-alvo comercial.
 */

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
const r4 = (v) => Math.round((n(v) + Number.EPSILON) * 10000) / 10000;
const quaseIgual = (a, b) => Math.abs(n(a) - n(b)) <= 0.01;

/**
 * Recebe uma única saída oficial e a composição econômica explicitamente
 * cadastrada. Não há qualquer lookup por NCM/NBS/descrição neste módulo.
 */
function analisarItemOficial({ item = {}, saida = null, formacao = null, despesasVariaveis = 0 }) {
  if (!saida) return incompleto(item, 'A formação de custo não possui vínculo explícito com uma saída oficial do motor.');
  if (!formacao) return incompleto(item, 'A saída oficial foi vinculada, mas não há composição de custo cadastrada.');

  const statusFormacao = formacao.status_formacao_custo || 'INCOMPLETO';
  const creditoTotal = n(formacao.credito_cbs_total);
  const creditoDireto = n(formacao.credito_cbs_direto);
  const creditoRateado = n(formacao.credito_cbs_rateado);
  const creditoNaoAlocado = n(formacao.credito_cbs_nao_alocado);
  const creditoPrecificavel = n(formacao.credito_cbs_precificavel);
  const reconciliado = quaseIgual(creditoTotal, creditoDireto + creditoRateado + creditoNaoAlocado)
    && quaseIgual(creditoPrecificavel, creditoDireto + creditoRateado);

  if (!reconciliado) return {
    ...incompleto(item, 'Os créditos da formação de custo não reconciliam.'),
    status: 'DIVERGENTE',
    formacao: { ...formacao, credito_cbs_total: creditoTotal, credito_direto: creditoDireto,
      credito_rateado: creditoRateado, credito_nao_alocado: creditoNaoAlocado,
      credito_cbs_precificavel: creditoPrecificavel },
  };
  if (statusFormacao !== 'COMPLETO') return {
    ...incompleto(item, 'A composição ou o rateio do custo ainda não está completo.'),
    formacao: { ...formacao, credito_cbs_total: creditoTotal, credito_direto: creditoDireto,
      credito_rateado: creditoRateado, credito_nao_alocado: creditoNaoAlocado,
      credito_cbs_precificavel: creditoPrecificavel },
  };

  const natureza = String(saida.natureza || '').toUpperCase();
  const sujeitoValidacao = ['INDETERMINADO', 'SIMULADO'].includes(natureza)
    || (formacao.componentes || []).some((c) => ['INDETERMINADO', 'SUJEITO_A_VALIDACAO'].includes(String(c.status_credito_determinacao || '').toUpperCase()));
  const despesa = n(despesasVariaveis);
  const custoBruto = n(formacao.custo_economico_bruto_alocado);
  const custoLiquido = r2(custoBruto - creditoPrecificavel);
  const precoAtual = n(saida.preco_atual);
  const baseEconomica = n(saida.base_economica);
  const precoProjetado = n(saida.preco_projetado);
  const despesasAtuais = r2(precoAtual * despesa);
  const despesasProjetadas = r2(precoProjetado * despesa);
  const margemAtual = r2(baseEconomica - custoLiquido - despesasAtuais);
  const margemProjetada = r2(baseEconomica - custoLiquido - despesasProjetadas);
  // Alvo comercial: base econômica necessária para preservar a margem atual.
  // A conversão para preço tributado deve ser feita pelo motor central em uma
  // simulação; precificação não volta a calcular CBS/IBS para isso.
  const baseAlvo = r2(margemAtual + custoLiquido + despesasProjetadas);

  return {
    status: sujeitoValidacao ? 'SUJEITO_A_VALIDACAO' : 'COMPLETO',
    resultado_definitivo: !sujeitoValidacao,
    item: { id: item.id, descricao: item.descricao || '', tipo: item.tipo || '', movimento_saida_id: item.movimento_saida_id || null },
    fonte: 'motor_resultados',
    saida: {
      movimento_id: saida.movimento_id || item.movimento_saida_id,
      preco_atual: precoAtual, base_economica: baseEconomica, cbs: n(saida.cbs), ibs: n(saida.ibs),
      credito_cbs: n(saida.credito_cbs), preco_projetado: precoProjetado,
      tratamento: saida.tratamento || null, cst: saida.cst || null, cclasstrib: saida.cclasstrib || null,
      natureza: saida.natureza || null, origem: saida.origem || 'MOTOR_RESULTADOS',
    },
    formacao: {
      cobertura: statusFormacao,
      custo_economico_bruto: custoBruto,
      credito_cbs_total: creditoTotal,
      credito_direto: creditoDireto,
      credito_rateado: creditoRateado,
      credito_nao_alocado: creditoNaoAlocado,
      credito_cbs_precificavel: creditoPrecificavel,
      custo_liquido: custoLiquido,
      reconciliacao_credito: reconciliado ? 'RECONCILIADO' : 'DIVERGENTE',
    },
    comercial: {
      despesas_variaveis_percentual: despesa,
      despesas_atuais: despesasAtuais,
      despesas_projetadas: despesasProjetadas,
      margem_atual: margemAtual,
      margem_atual_percentual: precoAtual ? r4(margemAtual / precoAtual) : null,
      margem_projetada: margemProjetada,
      margem_projetada_percentual: precoProjetado ? r4(margemProjetada / precoProjetado) : null,
      impacto_comercial: r2(margemProjetada - margemAtual),
      preco_alvo_base_economica: baseAlvo,
      preco_alvo_tributado: null,
      observacao_preco_alvo: 'O preço-alvo tributado exige uma simulação no motor central; esta camada não recalcula CBS/IBS.',
    },
  };
}

function incompleto(item, motivo) {
  return {
    status: 'INCOMPLETO', resultado_definitivo: false,
    item: { id: item.id, descricao: item.descricao || '', tipo: item.tipo || '', movimento_saida_id: item.movimento_saida_id || null },
    fonte: 'motor_resultados', motivo,
    saida: null, formacao: null, comercial: null,
  };
}

module.exports = { analisarItemOficial, r2, r4, quaseIgual };

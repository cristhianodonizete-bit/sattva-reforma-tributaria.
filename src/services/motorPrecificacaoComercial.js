/* Motor comercial único. CBS e tratamentos chegam como fatos do motor fiscal. */
const moeda = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const taxa = (v) => Number(v || 0);

function calcular(entrada = {}) {
  const custoBruto = entrada.custo_bruto == null ? moeda(entrada.custo_liquido) : moeda(entrada.custo_bruto);
  const creditoDireto = moeda(entrada.credito_direto);
  const creditoGlobalRateado = moeda(entrada.credito_global_rateado);
  const custoLiquido = moeda(entrada.custo_liquido == null ? custoBruto - creditoDireto - creditoGlobalRateado : entrada.custo_liquido);
  const porDentro = taxa(entrada.percentuais_por_dentro);
  const margem = taxa(entrada.margem_contribuicao);
  const divisor = 1 - porDentro - margem;
  if (!(divisor > 0)) return { status: 'INCOMPLETO', bloqueio: 'O divisor do markup deve ser maior que zero.', divisor };
  const precoBase = moeda(custoLiquido / divisor);
  const aliquotaCbs = taxa(entrada.aliquota_efetiva_cbs);
  const cbs = moeda(precoBase * aliquotaCbs);
  const precoFinal = moeda(precoBase + cbs);
  const margemValor = moeda(precoBase * margem);
  return {
    status: 'CALCULATED', modalidade: entrada.modalidade || 'REVENDA',
    custo_bruto: custoBruto, credito_direto: creditoDireto, credito_global_rateado: creditoGlobalRateado,
    custo_liquido: custoLiquido, percentuais_por_dentro: porDentro, margem_contribuicao: margem,
    divisor_markup: divisor, preco_base: precoBase, aliquota_efetiva_cbs: aliquotaCbs,
    cbs, preco_final: precoFinal, margem_valor: margemValor,
    memoria: ['custo líquido ÷ (1 − percentuais por dentro − margem)', 'CBS por fora sobre o preço-base'],
  };
}
function tratamentos(base, tratamentos = []) {
  const aceitos = new Set(['INTEGRAL', 'REDUCAO_60', 'REDUCAO_30', 'ALIQUOTA_ZERO', 'ISENCAO']);
  return tratamentos.map((t) => {
    if (!aceitos.has(t.tratamento)) return { tratamento: t.tratamento, status:'INCOMPLETO', bloqueio:'Tratamento tributário não reconhecido.' };
    if (t.tratamento === 'ALIQUOTA_ZERO' && t.estorna_credito) return { tratamento:t.tratamento,status:'INCOMPLETO',bloqueio:'Alíquota zero não pode estornar crédito sem regra fiscal explícita.' };
    if (t.tratamento === 'ISENCAO' && t.preserva_credito) return { tratamento:t.tratamento,status:'INCOMPLETO',bloqueio:'Isenção com manutenção de crédito exige regra fiscal explícita.' };
    return {
    tratamento: t.tratamento, preserva_credito: Boolean(t.preserva_credito), estorna_credito: Boolean(t.estorna_credito),
    ...calcular({ ...base, aliquota_efetiva_cbs: t.aliquota_efetiva_cbs }),
    };
  });
}
module.exports = { calcular, tratamentos };

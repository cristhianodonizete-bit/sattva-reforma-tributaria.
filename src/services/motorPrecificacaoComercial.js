/* Motor comercial único. CBS e tratamentos chegam como fatos do motor fiscal. */
const moeda = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const taxa = (v) => Number(v || 0);

function calcular(entrada = {}) {
  const custoLiquido = moeda(entrada.custo_liquido);
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
    custo_liquido: custoLiquido, percentuais_por_dentro: porDentro, margem_contribuicao: margem,
    divisor_markup: divisor, preco_base: precoBase, aliquota_efetiva_cbs: aliquotaCbs,
    cbs, preco_final: precoFinal, margem_valor: margemValor,
    memoria: ['custo líquido ÷ (1 − percentuais por dentro − margem)', 'CBS por fora sobre o preço-base'],
  };
}
function tratamentos(base, tratamentos = []) {
  return tratamentos.map((t) => ({
    tratamento: t.tratamento, preserva_credito: Boolean(t.preserva_credito), estorna_credito: Boolean(t.estorna_credito),
    ...calcular({ ...base, aliquota_efetiva_cbs: t.aliquota_efetiva_cbs }),
  }));
}
module.exports = { calcular, tratamentos };

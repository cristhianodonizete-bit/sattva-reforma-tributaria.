/* Contrato técnico dos dois tratamentos atualmente certificados no pacote.
 * Percentuais usam pontos percentuais: 0.65 = 0,65% e 3 = 3,00%. */
const TRATAMENTOS = {
  ALIQUOTA_ZERO_PIS_COFINS: {
    tratamento: 'ALÍQUOTA ZERO', cst_pis: '06', cst_cofins: '06',
    pis_percentual: 0, cofins_percentual: 0, regime_pis_cofins: null,
  },
  CUMULATIVO_OBRIGATORIO: {
    tratamento: 'CUMULATIVIDADE OBRIGATÓRIA', cst_pis: '01', cst_cofins: '01',
    pis_percentual: 0.65, cofins_percentual: 3, regime_pis_cofins: null,
  },
};

function especificacao(tratamento) {
  const chave = String(tratamento || '').trim();
  const regra = TRATAMENTOS[chave];
  if (!regra) throw new Error(`Tratamento PIS/Cofins não certificado: ${chave || 'vazio'}.`);
  return { ...regra, chave };
}

function catalogoResolvido(tratamento, fundamento = '') {
  const r = especificacao(tratamento);
  if (r.chave === 'ALIQUOTA_ZERO_PIS_COFINS') {
    return { tratamento_pis_cofins: r.tratamento, cst_pis_atual: r.cst_pis,
      cst_cofins_atual: r.cst_cofins, pis_percentual: r.pis_percentual,
      cofins_percentual: r.cofins_percentual, regra_precedencia: fundamento };
  }
  return { tratamento_pis_cofins: r.tratamento, cumulatividade_obrigatoria: 'SIM',
    pis_cumulativo_percentual: r.pis_percentual, cofins_cumulativo_percentual: r.cofins_percentual,
    total_cumulativo_percentual: r.pis_percentual + r.cofins_percentual,
    cst_pis_atual: r.cst_pis, cst_cofins_atual: r.cst_cofins,
    regra_precedencia: fundamento };
}

module.exports = { TRATAMENTOS, especificacao, catalogoResolvido };

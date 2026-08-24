/**
 * VOLTAR À BASE ECONÔMICA  (item 8 da especificação)
 * ---------------------------------------------------------------------------
 * Reconstrói o valor da operação SEM os tributos atuais que serão substituídos
 * pelo IBS/CBS, respeitando a forma de cálculo de cada um. Não é subtração
 * cega dos valores destacados.
 *
 * FORMA DE CÁLCULO DE CADA TRIBUTO
 *
 *  ICMS — POR DENTRO. Integra a própria base e o preço da mercadoria.
 *         Sai da composição: preço − ICMS destacado.
 *
 *  ISS  — POR DENTRO. Integra o preço do serviço.
 *         Sai da composição: preço − ISS destacado.
 *
 *  PIS/COFINS — POR DENTRO no preço (o adquirente paga um preço que os
 *         embute), embora sejam apurados sobre a receita do vendedor.
 *         Saem da composição pelo valor efetivamente incidente na operação.
 *         Atenção: no regime cumulativo o destaque normalmente não existe no
 *         documento; nesse caso o valor é ESTIMADO pela alíquota do regime.
 *
 *  IPI  — POR FORA. NÃO integra o preço da mercadoria: é somado a ele.
 *         Logo não deve ser retirado da base econômica — ele nunca esteve
 *         dentro dela. Retirá-lo produziria base econômica menor que a real.
 *
 *  ICMS-ST — POR FORA. Mesma lógica do IPI: soma ao valor da nota e não
 *         compõe o preço da mercadoria. Também não sai da base.
 *
 *  FRETE, SEGURO, OUTRAS DESPESAS — integram a base econômica. São custo real
 *         da operação, não tributo. Permanecem.
 *
 *  DESCONTO — reduz a base econômica. Já vem deduzido do valor do item.
 *
 * STATUS DA RECONSTRUÇÃO
 *   reconstruida  — todos os tributos relevantes vieram do documento
 *   estimada      — algum componente foi estimado por alíquota de regime
 *   insuficiente  — não há dados mínimos; a base fica igual ao preço e o
 *                   resultado é marcado para validação
 *
 * O valor original do documento NUNCA é alterado (item 8, parte final).
 */

const regras = require('../services/regras');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const tem = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));

/**
 * Mantido apenas como referência do padrão de fábrica. Em execução, a
 * alíquota vem de services/regras (tabela param_regimes), editável na tela
 * de Configurações.
 */
const ESTIMATIVA_PIS_COFINS = {
  // Não optante pelo Simples sem distinção entre Real e Presumido: não dá para
  // estimar PIS/COFINS sem escolher um dos dois. Só se usa o valor destacado.
  regime_regular: null,
  lucro_real: 0.0925,          // não cumulativo: PIS 1,65% + COFINS 7,6%
  lucro_presumido: 0.0365,     // cumulativo: PIS 0,65% + COFINS 3%
  simples_nacional: null,      // vem da tabela do Simples, não daqui
  simples_regime_regular: null,
  mei: null,
  pessoa_fisica: 0,
  produtor_rural_pf: 0,
  imune_isento: 0,
  orgao_publico: 0,
  exterior: 0,
};
/** Fatia do PIS dentro do bloco PIS+COFINS — parametrizada em Configurações */
const proporcaoPis = () => regras.padrao('proporcao_pis', 0.1757);

/**
 * @param {object} item  dados do documento (valores originais, nunca alterados)
 *   valor .............. valor do item/operação (preço praticado)
 *   icms, iss, pis, cofins, ipi, icms_st ... valores destacados no documento
 *   frete, seguro, outras, desconto ........ componentes do valor
 *   regime ............. regime do EMITENTE
 *   tipo ............... 'mercadoria' | 'servico'
 *   simples ............ { aliquotaEfetiva, reparticao } quando emitente do Simples
 * @returns objeto de reconstrução, com rastreabilidade da fórmula
 */
function reconstruir(item) {
  const valor = num(item.valor);
  const tipo = item.tipo === 'servico' ? 'servico' : 'mercadoria';
  const regime = item.regime || 'lucro_real';
  const passos = [];
  const pendencias = [];
  let estimado = false;

  if (!valor) {
    return {
      status: 'insuficiente', tipo, regime,
      precoAtual: 0, baseEconomica: 0,
      tributosAtuais: { icms: 0, iss: 0, pis: 0, cofins: 0, ipi: 0, icms_st: 0, total: 0 },
      retiradosDaBase: 0, foraDaBase: 0, estimado: false,
      passos: [], pendencias: ['Item sem valor — base econômica não reconstruída.'],
    };
  }

  // ---------- tributos POR DENTRO (saem da base) ----------
  let icms = 0, iss = 0, pis = 0, cofins = 0;

  if (tipo === 'mercadoria') {
    if (tem(item.icms)) {
      icms = num(item.icms);
      passos.push({ tributo: 'ICMS', forma: 'por dentro', origem: 'documento', valor: r2(icms) });
    } else if (regime === 'lucro_real' || regime === 'lucro_presumido') {
      pendencias.push('ICMS não destacado no documento — verificar se a operação é isenta, não tributada ou se houve falha na extração.');
      passos.push({ tributo: 'ICMS', forma: 'por dentro', origem: 'ausente', valor: 0 });
    }
  } else if (tem(item.iss)) {
    iss = num(item.iss);
    passos.push({ tributo: 'ISS', forma: 'por dentro', origem: 'documento', valor: r2(iss) });
  }

  // PIS/COFINS
  const temPisCofins = tem(item.pis) || tem(item.cofins);
  if (temPisCofins) {
    pis = num(item.pis); cofins = num(item.cofins);
    passos.push({ tributo: 'PIS/COFINS', forma: 'por dentro', origem: 'documento', valor: r2(pis + cofins) });
  } else if (tem(item.pis_cofins_referencia)) {
    const bloco = valor * num(item.pis_cofins_referencia);
    pis = bloco * proporcaoPis(); cofins = bloco - pis;
    estimado = true;
    passos.push({ tributo: 'PIS/COFINS', forma: 'por dentro', origem: 'referência fiscal do serviço',
      formula: `valor × ${(num(item.pis_cofins_referencia) * 100).toFixed(2)}%`, valor: r2(bloco) });
  } else if (['simples_nacional', 'mei'].includes(regime)) {
    // No Simples não há destaque: a parcela vem da repartição do DAS.
    const s = item.simples;
    if (s && s.aliquotaEfetiva && s.reparticao) {
      const parcela = valor * s.aliquotaEfetiva * (num(s.reparticao.pis) + num(s.reparticao.cofins));
      pis = parcela * proporcaoPis(); cofins = parcela - pis;
      estimado = true;
      passos.push({ tributo: 'PIS/COFINS', forma: 'por dentro', origem: 'repartição do DAS',
        formula: `valor × alíquota efetiva (${(s.aliquotaEfetiva * 100).toFixed(4)}%) × repartição PIS+COFINS`, valor: r2(parcela) });
    } else {
      pendencias.push('Fornecedor do Simples sem faixa determinada — parcela de PIS/COFINS embutida no DAS não pôde ser calculada.');
    }
  } else {
    const aliq = regras.estimativaPisCofins(regime);
    if (aliq === null && regime === 'regime_regular') {
      pendencias.push('Emitente não optante pelo Simples, mas o documento não destaca PIS/COFINS e o regime específico (Real ou Presumido) não está cadastrado — a parcela não foi retirada da base.');
    } else if (aliq) {
      const bloco = valor * aliq;
      pis = bloco * proporcaoPis(); cofins = bloco - pis;
      estimado = true;
      passos.push({ tributo: 'PIS/COFINS', forma: 'por dentro', origem: 'estimado pelo regime',
        formula: `valor × ${(aliq * 100).toFixed(2)}% (${regime})`, valor: r2(bloco) });
      pendencias.push('PIS/COFINS estimado pela alíquota do regime — o documento não traz o valor destacado.');
    }
  }

  // No Simples, a parcela de ICMS/ISS também está embutida no DAS
  if (['simples_nacional', 'mei'].includes(regime) && !icms && !iss) {
    const s = item.simples;
    if (s && s.aliquotaEfetiva && s.reparticao && num(s.reparticao.icms_iss)) {
      const parcela = valor * s.aliquotaEfetiva * num(s.reparticao.icms_iss);
      if (tipo === 'servico') iss = parcela; else icms = parcela;
      estimado = true;
      passos.push({ tributo: tipo === 'servico' ? 'ISS (no DAS)' : 'ICMS (no DAS)', forma: 'por dentro',
        origem: 'repartição do DAS',
        formula: `valor × alíquota efetiva × repartição ICMS/ISS (${(num(s.reparticao.icms_iss) * 100).toFixed(2)}%)`,
        valor: r2(parcela) });
    }
  }

  // ---------- tributos POR FORA (permanecem fora da base) ----------
  // Quais tributos saem da base é decisão de configuração, não de código:
  // a tabela param_tributos define a forma de cálculo de cada um.
  const ipi = tem(item.ipi) ? num(item.ipi) : 0;
  const icmsSt = tem(item.icms_st) ? num(item.icms_st) : 0;
  const regraIpi = regras.tributo('ipi');
  const regraSt = regras.tributo('icms_st');
  if (ipi) passos.push({ tributo: regraIpi.label || 'IPI', forma: regraIpi.forma === 'fora' ? 'por fora' : 'por dentro',
    origem: 'documento', valor: r2(ipi), observacao: regraIpi.descricao });
  if (icmsSt) passos.push({ tributo: regraSt.label || 'ICMS-ST', forma: regraSt.forma === 'fora' ? 'por fora' : 'por dentro',
    origem: 'documento', valor: r2(icmsSt), observacao: regraSt.descricao });

  // ---------- composição ----------
  let retiradosDaBase = 0, foraDaBase = 0;
  for (const [chave, valor] of [['icms', icms], ['iss', iss], ['pis', pis], ['cofins', cofins],
                                 ['ipi', ipi], ['icms_st', icmsSt]]) {
    if (!valor) continue;
    if (regras.tributo(chave).saiDaBase) retiradosDaBase += valor; else foraDaBase += valor;
  }

  // Se o valor do item já vier somado de IPI/ST (nota totalizada), o preço da
  // mercadoria é o valor menos esses acréscimos. O campo `valor_com_acrescimos`
  // sinaliza esse caso; por padrão assume-se que `valor` é o valor do produto.
  const precoMercadoria = item.valor_com_acrescimos ? valor - foraDaBase : valor;
  const baseEconomica = Math.max(precoMercadoria - retiradosDaBase, 0);

  let status = 'reconstruida';
  if (!retiradosDaBase) { status = 'insuficiente'; pendencias.push('Nenhum tributo atual identificado na operação — base econômica igual ao preço praticado.'); }
  else if (estimado) status = 'estimada';

  return {
    status, tipo, regime,
    precoAtual: r2(valor),
    precoMercadoria: r2(precoMercadoria),
    baseEconomica: r2(baseEconomica),
    tributosAtuais: { icms: r2(icms), iss: r2(iss), pis: r2(pis), cofins: r2(cofins),
      ipi: r2(ipi), icms_st: r2(icmsSt), total: r2(retiradosDaBase + foraDaBase) },
    retiradosDaBase: r2(retiradosDaBase),
    foraDaBase: r2(foraDaBase),
    cargaAtual: precoMercadoria ? r6((retiradosDaBase + foraDaBase) / precoMercadoria) : 0,
    estimado,
    formula: item.valor_com_acrescimos
      ? 'base = (valor − IPI − ICMS-ST) − (ICMS + ISS + PIS + COFINS)'
      : 'base = valor − (ICMS + ISS + PIS + COFINS)   [IPI e ICMS-ST são por fora e não integram a base]',
    passos, pendencias,
  };
}

/**
 * Alíquota efetiva do Simples Nacional a partir do RBT12.
 * Retorna também a repartição da faixa, usada para achar a parcela de
 * IBS/CBS embutida no DAS.
 */
function simplesEfetivo(anexo, rbt12, tabelas) {
  const a = tabelas[anexo] || tabelas.I;
  if (!a) return null;
  const rb = num(rbt12);
  const faixa = a.faixas.find((f) => rb <= f[1]) || a.faixas[a.faixas.length - 1];
  const [numero, limite, nominal, deduzir, reparticao] = faixa;
  const efetiva = rb > 0 ? (rb * nominal - deduzir) / rb : nominal;
  return {
    anexo, anexoNome: a.nome, faixa: numero, limite, rbt12: rb,
    aliquotaNominal: nominal, parcelaDeduzir: deduzir,
    aliquotaEfetiva: r6(Math.max(efetiva, 0)),
    reparticao,
    formula: `(${rb.toLocaleString('pt-BR')} × ${(nominal * 100).toFixed(2)}% − ${deduzir.toLocaleString('pt-BR')}) ÷ ${rb.toLocaleString('pt-BR')}`,
  };
}

module.exports = { reconstruir, simplesEfetivo, ESTIMATIVA_PIS_COFINS };

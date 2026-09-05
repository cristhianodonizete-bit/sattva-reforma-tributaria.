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
const catalogoFiscal = require('../services/catalogoFiscal');
const { aplicarPercentual, percentualDeValor, arredondarMoeda } = require('../services/percentual');

const r2 = arredondarMoeda;
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
  lucro_real: 9.25,            // não cumulativo: PIS 1,65% + COFINS 7,6%
  lucro_presumido: 3.65,       // cumulativo: PIS 0,65% + COFINS 3%
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

/** Mantém as alíquotas legais conhecidas separadas do percentual agregado. */
function repartirPisCofins(total, percentualTotal) {
  const p = num(percentualTotal);
  if (Math.abs(p - 3.65) < 1e-9) return { pis: total * (0.65 / 3.65), cofins: total * (3 / 3.65), aliquotaPis: 0.65, aliquotaCofins: 3 };
  if (Math.abs(p - 9.25) < 1e-9) return { pis: total * (1.65 / 9.25), cofins: total * (7.6 / 9.25), aliquotaPis: 1.65, aliquotaCofins: 7.6 };
  const aliquotaPis = p * proporcaoPis();
  return { pis: total * proporcaoPis(), cofins: total - total * proporcaoPis(), aliquotaPis, aliquotaCofins: p - aliquotaPis };
}

function memoriaTributo({ valor = 0, base = null, aliquota = null, origem = 'INDETERMINADO', regra = '', evidencia = '', natureza = 'INDETERMINADO', status = 'INDETERMINADO', justificativa = '' } = {}) {
  return { valor: r2(valor), base: base === null ? null : r2(base), aliquota: aliquota === null ? null : r6(aliquota), origem, regra, evidencia, natureza, status, justificativa };
}

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
function reconstruir(item, contexto = {}) {
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
  let memoriaTributos = {
    icms: memoriaTributo({ status: tipo === 'servico' ? 'NAO_APLICAVEL' : 'INDETERMINADO', natureza: tipo === 'servico' ? 'CALCULADO' : 'INDETERMINADO', justificativa: tipo === 'servico' ? 'Operação de serviço: ICMS não integra esta reconstrução.' : 'ICMS não informado.' }),
    iss: memoriaTributo({ status: tipo === 'mercadoria' ? 'NAO_APLICAVEL' : 'INDETERMINADO', natureza: tipo === 'mercadoria' ? 'CALCULADO' : 'INDETERMINADO', justificativa: tipo === 'mercadoria' ? 'Operação de mercadoria: ISS não integra esta reconstrução.' : 'ISS não informado.' }),
    pis: memoriaTributo(), cofins: memoriaTributo(),
  };

  if (tipo === 'mercadoria') {
    if (tem(item.icms)) {
      icms = num(item.icms);
      passos.push({ tributo: 'ICMS', forma: 'por dentro', origem: 'documento', valor: r2(icms) });
      memoriaTributos.icms = memoriaTributo({ valor: icms, base: valor, aliquota: valor ? icms / valor : 0, origem: 'DOCUMENTO', regra: 'VALOR_DESTACADO_DOCUMENTO', evidencia: 'Campo ICMS do documento fiscal', natureza: 'REAL', status: 'DETERMINADO', justificativa: 'ICMS destacado no documento.' });
    } else if (regime === 'lucro_real' || regime === 'lucro_presumido') {
      pendencias.push('ICMS não destacado no documento — verificar se a operação é isenta, não tributada ou se houve falha na extração.');
      passos.push({ tributo: 'ICMS', forma: 'por dentro', origem: 'ausente', valor: 0 });
    }
  } else if (tem(item.iss)) {
    iss = num(item.iss);
    passos.push({ tributo: 'ISS', forma: 'por dentro', origem: 'documento', valor: r2(iss) });
    memoriaTributos.iss = memoriaTributo({ valor: iss, base: valor, aliquota: valor ? iss / valor : 0, origem: 'DOCUMENTO', regra: 'VALOR_DESTACADO_DOCUMENTO', evidencia: 'Campo ISS do documento fiscal', natureza: 'REAL', status: 'DETERMINADO', justificativa: 'ISS extraído do documento; não é alíquota default.' });
  }

  // PIS/COFINS
  const valorPisCofinsDocumento = num(item.pis) + num(item.cofins);
  // A projeção trabalha com carga saneada. Valores do XML permanecem como
  // evidência histórica, mas não comandam a reconstrução quando a matriz
  // fiscal versionada já resolve a operação. Uma tela de auditoria pode optar
  // expressamente por usar o documento, sem mudar o padrão da projeção.
  const usarDocumentoComoCarga = item.usar_documento_pis_cofins === true;
  const temPisCofins = usarDocumentoComoCarga
    && (valorPisCofinsDocumento > 0 || item.pis_cofins_zero_comprovado === true);
  let memoriaPisCofins = null;
  let pisCofinsResolvido = false;
  const registrarCargaResolvida = (resolucao) => {
    const bloco = num(resolucao.valor);
    const partes = repartirPisCofins(bloco, resolucao.percentual);
    pis = partes.pis; cofins = partes.cofins;
    estimado = estimado || resolucao.natureza === 'SIMULADO';
    pisCofinsResolvido = true;
    passos.push({ tributo: 'PIS/COFINS', forma: 'por dentro', origem: resolucao.origem,
      formula: `valor × ${num(resolucao.percentual).toFixed(3)}% (${resolucao.metodo})`, valor: r2(bloco) });
    memoriaPisCofins = { carga_atual_pis_cofins_valor: r2(bloco), carga_atual_pis_cofins_percentual: r6(resolucao.percentual), carga_atual_pis_cofins_origem: resolucao.origem, carga_atual_pis_cofins_natureza: resolucao.natureza, modo_reconstrucao_monofasia: resolucao.modoMonofasia || null, regime_receita: resolucao.catalogo?.regime_pis_cofins_receita || regime, tratamento_especifico: resolucao.catalogo?.tratamento_pis_cofins || 'NORMAL', papel_na_cadeia: resolucao.catalogo?.papel_na_cadeia || 'NÃO APLICÁVEL', fundamento: resolucao.catalogo?.regra_precedencia || '', base_reconstrucao_metodo: resolucao.metodo, base_reconstrucao_percentual: r6(resolucao.percentual), base_reconstrucao_valor_excluido: r2(bloco), base_reconstrucao_fonte: resolucao.catalogo ? 'CATÁLOGO FISCAL' : resolucao.origem, base_reconstrucao_natureza: resolucao.natureza };
    memoriaTributos.pis = memoriaTributo({ valor: pis, base: valor, aliquota: partes.aliquotaPis, origem: resolucao.origem, regra: resolucao.metodo, evidencia: resolucao.catalogo ? 'Catálogo fiscal e parâmetros centrais' : 'Parâmetro central de regime', natureza: resolucao.natureza, status: 'DETERMINADO', justificativa: resolucao.justificativa || resolucao.metodo });
    memoriaTributos.cofins = memoriaTributo({ valor: cofins, base: valor, aliquota: partes.aliquotaCofins, origem: resolucao.origem, regra: resolucao.metodo, evidencia: resolucao.catalogo ? 'Catálogo fiscal e parâmetros centrais' : 'Parâmetro central de regime', natureza: resolucao.natureza, status: 'DETERMINADO', justificativa: resolucao.justificativa || resolucao.metodo });
  };
  if (temPisCofins) {
    pis = num(item.pis); cofins = num(item.cofins);
    passos.push({ tributo: 'PIS/COFINS', forma: 'por dentro', origem: 'documento', valor: r2(pis + cofins) });
    memoriaPisCofins = { carga_atual_pis_cofins_valor: r2(pis + cofins), carga_atual_pis_cofins_percentual: valor ? r6(percentualDeValor(pis + cofins, valor)) : 0, carga_atual_pis_cofins_origem: 'DOCUMENTO', carga_atual_pis_cofins_natureza: 'REAL', modo_reconstrucao_monofasia: 'VALOR_REAL_DOCUMENTO', base_reconstrucao_metodo: 'DOCUMENTO', base_reconstrucao_percentual: valor ? r6(percentualDeValor(pis + cofins, valor)) : 0, base_reconstrucao_valor_excluido: r2(pis + cofins), base_reconstrucao_fonte: 'DOCUMENTO', base_reconstrucao_natureza: 'REAL' };
    memoriaTributos.pis = memoriaTributo({ valor: pis, base: valor, aliquota: percentualDeValor(pis, valor), origem: 'DOCUMENTO', regra: 'VALOR_DESTACADO_DOCUMENTO', evidencia: 'Campo PIS do documento fiscal', natureza: 'REAL', status: 'DETERMINADO', justificativa: 'PIS documentado.' });
    memoriaTributos.cofins = memoriaTributo({ valor: cofins, base: valor, aliquota: percentualDeValor(cofins, valor), origem: 'DOCUMENTO', regra: 'VALOR_DESTACADO_DOCUMENTO', evidencia: 'Campo COFINS do documento fiscal', natureza: 'REAL', status: 'DETERMINADO', justificativa: 'COFINS documentado.' });
  } else if (regime === 'mei') {
    // MEI não carrega PIS/COFINS separadamente para esta reconstrução.
    registrarCargaResolvida({ percentual: 0, valor: 0, origem: 'REGRA_REGIME', natureza: 'CALCULADO', metodo: 'MEI_SEM_PIS_COFINS', justificativa: 'MEI: carga de PIS/COFINS reconstruída como zero pela regra de regime.' });
  } else {
    // Regra específica do item (alíquota zero ou monofasia) precede o regime.
    // O documento é preservado, mas deliberadamente não é usado como cálculo.
    let resolucao = catalogoFiscal.resolver(item, { ignorarDocumento: !usarDocumentoComoCarga });
    if (resolucao.percentual !== null) {
      registrarCargaResolvida(resolucao);
    } else if (!['simples_nacional'].includes(regime)) {
    if (resolucao.percentual === null && resolucao.continuar && item.pis_cofins_referencia !== null && item.pis_cofins_referencia !== undefined) {
      const p = num(item.pis_cofins_referencia);
      resolucao = { percentual: p, valor: aplicarPercentual(valor, p), origem: 'REFERENCIA_EMPRESA', natureza: 'CALCULADO', metodo: 'REFERENCIA_EMPRESA', catalogo: resolucao.catalogo };
    }
    // A regra geral do regime é permitida somente quando o contexto a declarou
    // como regra versionada aplicável. Isso evita que a mera ausência de um
    // catálogo conclusivo vire, silenciosamente, uma alíquota automática.
    if (resolucao.percentual === null && resolucao.continuar && item.regra_geral_regime_confirmada === true) {
      const p = regras.estimativaPisCofins(regime);
      if (p !== null && p !== undefined) resolucao = { percentual: p, valor: aplicarPercentual(valor, p), origem: 'REGRA_REGIME', natureza: 'CALCULADO', metodo: 'REGRA_GERAL_REGIME', catalogo: resolucao.catalogo, justificativa: 'Fallback parametrizado em Regimes e crédito; aplicado após ausência de documento e regra específica conclusiva.' };
    }
    if (resolucao.percentual !== null) {
      registrarCargaResolvida(resolucao);
      // Regra versionada conclusiva é um tratamento calculado, não uma
      // pendência. A memória preserva a origem para revisão/auditoria.
    } else {
      pendencias.push(`PIS/COFINS não determinado: ${resolucao.metodo}.`);
      memoriaPisCofins = { carga_atual_pis_cofins_valor: null, carga_atual_pis_cofins_percentual: null, carga_atual_pis_cofins_origem: resolucao.origem, carga_atual_pis_cofins_natureza: resolucao.natureza, modo_reconstrucao_monofasia: resolucao.modoMonofasia || 'INDETERMINADO', regime_receita: resolucao.catalogo?.regime_pis_cofins_receita || regime, tratamento_especifico: resolucao.catalogo?.tratamento_pis_cofins || 'INDETERMINADO', papel_na_cadeia: resolucao.catalogo?.papel_na_cadeia || 'INDETERMINADO', fundamento: resolucao.catalogo?.regra_precedencia || '', base_reconstrucao_metodo: resolucao.metodo, motivo_indeterminacao: resolucao.motivoIndeterminacao || 'SEM_EVIDENCIA', evidencia_necessaria: resolucao.evidenciaNecessaria || null, candidatos_existentes: resolucao.candidatos || [], base_reconstrucao_percentual: null, base_reconstrucao_valor_excluido: 0, base_reconstrucao_fonte: resolucao.catalogo ? 'CATÁLOGO FISCAL' : '', base_reconstrucao_natureza: resolucao.natureza };
      memoriaTributos.pis = memoriaTributo({ regra: resolucao.metodo, evidencia: resolucao.catalogo ? 'Catálogo fiscal' : '', justificativa: resolucao.justificativa || 'Não houve evidência suficiente para determinar PIS.' });
      memoriaTributos.cofins = memoriaTributo({ regra: resolucao.metodo, evidencia: resolucao.catalogo ? 'Catálogo fiscal' : '', justificativa: resolucao.justificativa || 'Não houve evidência suficiente para determinar COFINS.' });
    }
    } else if (regime === 'simples_nacional') {
    // No Simples não há destaque: a parcela vem da repartição do DAS.
      const fallback = regras.estimativaPisCofins(regime);
      if (fallback !== null && fallback > 0) {
        registrarCargaResolvida({ percentual: fallback, valor: aplicarPercentual(valor, fallback), origem: 'PREMISSA_REGIME_SIMPLES', natureza: 'SIMULADO', metodo: 'PREMISSA_SIMPLES_25', justificativa: 'Premissa versionada para reconstrução econômica do Simples; não é alíquota legal fixa do DAS.' });
      } else pendencias.push('Fornecedor do Simples sem faixa determinada — parcela de PIS/COFINS embutida no DAS não pôde ser calculada.');
    } else {
      pendencias.push(`PIS/COFINS não determinado: ${resolucao.metodo}.`);
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
  // A base integral preserva a metodologia histórica de retirada dos
  // tributos substituídos por IBS/CBS. A visão CBS-only, porém, só neutraliza
  // PIS/COFINS: ISS e ICMS continuam identificados e economicamente
  // presentes enquanto IBS estiver desabilitado.
  let retiradosIntegral = 0, foraDaBase = 0;
  for (const [chave, valor] of [['icms', icms], ['iss', iss], ['pis', pis], ['cofins', cofins],
                                 ['ipi', ipi], ['icms_st', icmsSt]]) {
    if (!valor) continue;
    if (regras.tributo(chave).saiDaBase) retiradosIntegral += valor; else foraDaBase += valor;
  }

  // Se o valor do item já vier somado de IPI/ST (nota totalizada), o preço da
  // mercadoria é o valor menos esses acréscimos. O campo `valor_com_acrescimos`
  // sinaliza esse caso; por padrão assume-se que `valor` é o valor do produto.
  const precoMercadoria = item.valor_com_acrescimos ? valor - foraDaBase : valor;
  const baseEconomicaIntegral = Math.max(precoMercadoria - retiradosIntegral, 0);
  const retiradosCbs = pis + cofins;
  const baseEconomicaCbs = Math.max(precoMercadoria - retiradosCbs, 0);
  const ibsHabilitado = contexto.ibsHabilitado === true;
  const tipoBaseEconomica = ibsHabilitado ? 'INTEGRAL' : 'CBS_ONLY';
  const baseEconomica = ibsHabilitado ? baseEconomicaIntegral : baseEconomicaCbs;
  const retiradosDaBase = ibsHabilitado ? retiradosIntegral : retiradosCbs;
  const componentesRetirados = ibsHabilitado
    ? { icms: r2(icms), iss: r2(iss), pis: r2(pis), cofins: r2(cofins) }
    : { icms: 0, iss: 0, pis: r2(pis), cofins: r2(cofins) };
  const componentesPreservados = ibsHabilitado
    ? { icms: 0, iss: 0 }
    : { icms: r2(icms), iss: r2(iss) };

  let status = 'reconstruida';
  const temComponenteIndeterminado = [memoriaTributos.pis, memoriaTributos.cofins].some((x) => x.status === 'INDETERMINADO');
  if (temComponenteIndeterminado) status = 'parcialmente_determinada';
  else if (!retiradosDaBase && !pisCofinsResolvido) { status = 'insuficiente'; pendencias.push('Nenhum tributo atual identificado na operação — base econômica igual ao preço praticado.'); }
  else if (estimado) status = 'estimada';

  return {
    status, tipo, regime,
    precoAtual: r2(valor),
    precoMercadoria: r2(precoMercadoria),
    baseEconomica: r2(baseEconomica),
    baseEconomicaCbs: r2(baseEconomicaCbs),
    baseEconomicaIntegral: r2(baseEconomicaIntegral),
    tipoBaseEconomica,
    versaoMetodologiaBase: ibsHabilitado ? 'INTEGRAL_V1' : 'CBS_ONLY_V1',
    tributosAtuais: { icms: r2(icms), iss: r2(iss), pis: r2(pis), cofins: r2(cofins),
      ipi: r2(ipi), icms_st: r2(icmsSt), total: r2(retiradosIntegral + foraDaBase) },
    retiradosDaBase: r2(retiradosDaBase),
    foraDaBase: r2(foraDaBase),
    cargaAtual: precoMercadoria ? r6((retiradosIntegral + foraDaBase) / precoMercadoria) : 0,
    estimado,
    memoriaTributos,
    memoriaPisCofins: { ...(memoriaPisCofins || { carga_atual_pis_cofins_valor: null, carga_atual_pis_cofins_percentual: null, carga_atual_pis_cofins_origem: 'INDETERMINADO', carga_atual_pis_cofins_natureza: 'INDETERMINADO', modo_reconstrucao_monofasia: 'INDETERMINADO', base_reconstrucao_metodo: 'INDETERMINADO', base_reconstrucao_percentual: null, base_reconstrucao_valor_excluido: 0, base_reconstrucao_fonte: '', base_reconstrucao_natureza: 'INDETERMINADO' }), tributos_retirados_da_base: componentesRetirados, tributos_preservados_na_visao_cbs: componentesPreservados, base_economica: r2(baseEconomica), base_economica_cbs: r2(baseEconomicaCbs), base_economica_integral: r2(baseEconomicaIntegral), tipo_base_economica: tipoBaseEconomica, versao_metodologia_base: ibsHabilitado ? 'INTEGRAL_V1' : 'CBS_ONLY_V1' },
    componentesRetirados,
    componentesPreservados,
    formula: ibsHabilitado
      ? 'base integral = valor − (ICMS + ISS + PIS + COFINS)'
      : 'base CBS = valor − (PIS + COFINS); ISS e ICMS permanecem na visão CBS porque IBS está desabilitado',
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

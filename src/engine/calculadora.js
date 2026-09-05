/**
 * MOTOR DA CALCULADORA DA REFORMA TRIBUTÁRIA
 * ---------------------------------------------------------------------------
 * Responsabilidades:
 *  1) GROSS-DOWN: dado um valor de operação, "voltar a base" e encontrar o
 *     valor SEM IMPOSTO, respeitando o regime tributário de quem emite.
 *  2) GROSS-UP: aplicar o IVA Dual (IBS+CBS) por FORA sobre essa base limpa.
 *  3) CRÉDITOS: calcular o que é aproveitável hoje e no novo modelo, conforme
 *     o regime do fornecedor (quem gera) e o regime do adquirente (quem toma).
 *  4) CUSTO EFETIVO e CARGA EFETIVA, ano a ano do cronograma de transição.
 *
 * Conceito-chave: hoje ICMS, ISS, PIS e COFINS são calculados "POR DENTRO"
 * (integram a própria base). O IBS e a CBS são "POR FORA" — não integram a
 * própria base nem a base um do outro. Por isso a comparação direta de
 * alíquotas nominais engana: só faz sentido comparar CARGA EFETIVA sobre a
 * mesma base limpa.
 */

const P = require('../config/parametros');
const regras = require('../services/regras');
const crypto = require('crypto');
const { aplicarPercentual, arredondarMoeda } = require('../services/percentual');

// O arquivo parametros é somente a semente para instalações novas. Em execução,
// os motores consultam a configuração persistida; a semente é fallback defensivo.
function regimeConfigurado(chave) {
  const salvo = regras.regime(chave);
  if (salvo) return {
    label: salvo.label, pisCofins: salvo.pisCofins, cumulativo: salvo.cumulativo,
    creditaAtual: { pisCofins: salvo.creditaAtualPisCofins, icms: salvo.creditaAtualIcms, ipi: salvo.creditaAtualIpi },
    geraCreditoAtual: { pisCofins: salvo.geraCreditoAtualPisCofins, icms: salvo.geraCreditoAtualIcms, ipi: salvo.geraCreditoAtualIpi },
    creditaNovo: salvo.creditaNovo, geraCreditoNovo: salvo.geraCreditoNovo,
  };
  return P.REGIMES[chave] || P.REGIMES.lucro_real;
}
function padraoConfigurado(chave, fallback) { return num(regras.padrao(chave, fallback)); }
function parametrosDoAno(ano, parametrosIVA) {
  const base = P.CRONOGRAMA[ano] || P.CRONOGRAMA[2027];
  const salvo = parametrosIVA && (parametrosIVA[ano] || parametrosIVA);
  return salvo ? { ...base, ...salvo } : base;
}

const r2 = arredondarMoeda;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

// ---------------------------------------------------------------------------
// 1. GROSS-DOWN — encontra o valor sem imposto
// ---------------------------------------------------------------------------
/**
 * @param {object} op
 *   valor ............ valor total da operação (com tributos por dentro)
 *   regime ........... regime tributário do EMITENTE (fornecedor/prestador)
 *   tipo ............. 'mercadoria' | 'servico'
 *   baseCalculo ...... base de cálculo informada na nota (opcional)
 *   icms, pis, cofins, ipi, iss, icmsSt ... valores informados na nota (opcional)
 *   aliqIcms, aliqIss, aliqIpi, aliqSimples ... alíquotas (quando não há valor)
 * @returns detalhamento do preço atual
 */
function grossDown(op) {
  const valor = num(op.valor);
  const tipo = op.tipo === 'servico' ? 'servico' : 'mercadoria';
  const regimeKey = op.regime || 'lucro_real';
  const regime = regimeConfigurado(regimeKey);
  const base = num(op.baseCalculo) || valor;

  const informado = ['icms', 'pis', 'cofins', 'ipi', 'iss'].some((k) => op[k] !== undefined && op[k] !== null && op[k] !== '');

  let icms = 0, pis = 0, cofins = 0, ipi = 0, iss = 0;
  const icmsSt = num(op.icmsSt);

  if (informado) {
    // Movimentação importada: usa os valores reais da nota.
    icms = num(op.icms); ipi = num(op.ipi); iss = num(op.iss);
    pis = num(op.pis); cofins = num(op.cofins);
    if (num(op.pisCofins) && !pis && !cofins) { pis = num(op.pisCofins) * 0.1757; cofins = num(op.pisCofins) - pis; }
  } else {
    // Estimativa a partir do regime + alíquotas padrão.
    if (regimeKey === 'simples_nacional' || regimeKey === 'simples_regime_regular' || regimeKey === 'mei') {
      const aliqDas = op.aliqSimples !== undefined ? num(op.aliqSimples) : padraoConfigurado('simples_efetivo', P.PADROES.simplesEfetivo);
      // No Simples os tributos estão embutidos no DAS: tratamos como um bloco.
      const das = base * aliqDas;
      // Separação apenas indicativa entre a parte "consumo" e a parte "renda/CPP"
      const parteConsumo = das * padraoConfigurado('simples_parcela_creditavel', P.PADROES.simplesParcelaCreditavel);
      if (tipo === 'servico') { iss = parteConsumo * 0.55; pis = parteConsumo * 0.08; cofins = parteConsumo * 0.37; }
      else { icms = parteConsumo * 0.55; pis = parteConsumo * 0.08; cofins = parteConsumo * 0.37; }
    } else if (regimeKey === 'imune_isento' || regimeKey === 'pessoa_fisica' || regimeKey === 'produtor_rural_pf' || regimeKey === 'orgao_publico' || regimeKey === 'exterior') {
      // sem tributos destacados
    } else {
      const pc = op.aliqPisCofins !== undefined && op.aliqPisCofins !== ''
        ? num(op.aliqPisCofins) : (regime.pisCofins || 0);
      const blocoPisCofins = aplicarPercentual(base, pc);
      pis = blocoPisCofins * 0.1757;     // proporção PIS dentro do bloco PIS/COFINS
      cofins = blocoPisCofins * 0.8243;
      if (tipo === 'servico') {
        iss = base * (op.aliqIss !== undefined ? num(op.aliqIss) : padraoConfigurado('iss', P.PADROES.iss));
      } else {
        icms = base * (op.aliqIcms !== undefined ? num(op.aliqIcms) : padraoConfigurado('icms_interno', P.PADROES.icmsInterno));
        ipi = base * (op.aliqIpi !== undefined ? num(op.aliqIpi) : padraoConfigurado('ipi', P.PADROES.ipi));
      }
    }
  }

  const tributosPorDentro = icms + pis + cofins + iss;   // integram o preço
  const tributosPorFora = ipi + icmsSt;                   // somam ao preço
  const totalTributos = tributosPorDentro + tributosPorFora;

  // Valor SEM IMPOSTO ("volta da base"): retiram-se apenas os tributos
  // calculados POR DENTRO (ICMS, ISS, PIS, COFINS), que integram o preço.
  // IPI e ICMS-ST são calculados POR FORA: somam ao valor da nota e nunca
  // estiveram dentro do preço da mercadoria, então não saem da base — retirá-los
  // produziria base econômica menor que a real.
  // (Mesma regra aplicada em engine/reconstrucao.js, usada pelo motor.)
  const valorSemImposto = Math.max(valor - tributosPorDentro, 0);

  return {
    regime: regimeKey,
    regimeLabel: regime.label,
    tipo,
    valorOperacao: r2(valor),
    baseCalculo: r2(base),
    tributos: { icms: r2(icms), pis: r2(pis), cofins: r2(cofins), ipi: r2(ipi), iss: r2(iss), icmsSt: r2(icmsSt) },
    totalTributos: r2(totalTributos),
    tributosPorDentro: r2(tributosPorDentro),
    tributosPorFora: r2(tributosPorFora),
    valorSemImposto: r2(valorSemImposto),
    cargaEfetiva: valor ? r4(totalTributos / valor) : 0,
  };
}

// ---------------------------------------------------------------------------
// 2. CRÉDITO ATUAL — quanto o adquirente aproveita hoje
// ---------------------------------------------------------------------------
function creditoAtual(atual, regimeAdquirente) {
  const adq = regimeConfigurado(regimeAdquirente);
  const forn = regimeConfigurado(atual.regime);
  const t = atual.tributos;
  let c = 0;
  const det = { icms: 0, pisCofins: 0, ipi: 0 };

  const fornecedorSimples = ['simples_nacional', 'mei'].includes(atual.regime);

  if (adq.creditaAtual.icms && forn.geraCreditoAtual.icms) { det.icms = t.icms; }
  else if (adq.creditaAtual.icms && fornecedorSimples && atual.regime === 'simples_nacional') {
    det.icms = t.icms; // ICMS informado no DAS para revenda (art. 23 §1º LC 123)
  }
  if (adq.creditaAtual.pisCofins && forn.geraCreditoAtual.pisCofins) {
    // no não cumulativo o crédito é calculado sobre o valor de aquisição
    det.pisCofins = aplicarPercentual(atual.valorOperacao, regimeConfigurado('lucro_real').pisCofins);
  }
  if (adq.creditaAtual.ipi && forn.geraCreditoAtual.ipi) { det.ipi = t.ipi; }

  c = det.icms + det.pisCofins + det.ipi;
  return { total: r2(c), detalhe: { icms: r2(det.icms), pisCofins: r2(det.pisCofins), ipi: r2(det.ipi) } };
}

// Decisão da adquirente separada da carga que o fornecedor suportou na
// operação. Uma conclusão de crédito zero só é determinada quando decorre de
// regra expressa; ela nunca converte ausência de evidência em zero.
function resolverCreditoPisCofinsAdquirente({ regimeAdquirente, regraEspecificaCredito = null, referenciaFiscal = null } = {}) {
  const memoria = (decisao) => ({
    ...decisao,
    regra_versionamento: 'CREDITO_PIS_COFINS_ADQUIRENTE_V1',
    hash_lineage: crypto.createHash('sha256').update(JSON.stringify({
      regimeAdquirente, regraEspecificaCredito, referenciaFiscal, decisao,
    })).digest('hex'),
  });
  const superior = regraEspecificaCredito || referenciaFiscal;
  if (superior) {
    const elegibilidade = String(superior.elegibilidade || superior.status || '').toUpperCase();
    if (elegibilidade === 'ELEGIVEL') return memoria({ valor: null, status: 'DETERMINADO', classificacao: 'CREDITO_ELEGIVEL_POR_REGRA_ESPECIFICA', motivo: superior.motivo || 'Regra específica superior aplicável.', origem: regraEspecificaCredito ? 'REGRA_ESPECIFICA' : 'REFERENCIA_FISCAL', natureza: 'CALCULADO', ausencia_regra_especifica_superior: false });
    if (elegibilidade === 'NAO_ELEGIVEL') return memoria({ valor: 0, status: 'DETERMINADO', classificacao: 'CREDITO_NAO_ELEGIVEL_POR_REGRA_ESPECIFICA', motivo: superior.motivo || 'Regra específica superior veda o crédito.', origem: regraEspecificaCredito ? 'REGRA_ESPECIFICA' : 'REFERENCIA_FISCAL', natureza: 'CALCULADO', ausencia_regra_especifica_superior: false });
    return memoria({ valor: null, status: 'INDETERMINADO', classificacao: 'CREDITO_DEPENDE_CONDICAO_ESPECIFICA', motivo: superior.motivo || 'Regra específica exige condição ainda não comprovada.', origem: regraEspecificaCredito ? 'REGRA_ESPECIFICA' : 'REFERENCIA_FISCAL', natureza: 'INDETERMINADO', ausencia_regra_especifica_superior: false });
  }
  const regime = regimeConfigurado(regimeAdquirente);
  if (regime.cumulativo === true && regime.creditaAtual.pisCofins === false) {
    return memoria({ valor: 0, status: 'DETERMINADO', classificacao: 'CREDITO_NAO_ELEGIVEL_POR_REGIME', motivo: 'Regime PIS/Cofins cumulativo sem crédito ordinário, na ausência de regra específica superior.', origem: 'REGRA_REGIME_ADQUIRENTE', natureza: 'CALCULADO', ausencia_regra_especifica_superior: true });
  }
  return memoria({ valor: null, status: 'INDETERMINADO', classificacao: 'CREDITO_INDETERMINADO', motivo: 'Regime da adquirente não permite concluir a elegibilidade ordinária sem regra superior.', origem: 'INDETERMINADO', natureza: 'INDETERMINADO', ausencia_regra_especifica_superior: true });
}

// ---------------------------------------------------------------------------
// 3. NOVO MODELO — IVA por fora, ano a ano
// ---------------------------------------------------------------------------
/**
 * @param {object} cfg
 *   valorSemImposto ... base limpa (saída do grossDown)
 *   ano ............... ano do cronograma
 *   reducao ........... chave de P.REDUCOES
 *   aliqEspecifica .... alíquota efetiva total (usada em regime específico)
 *   regime ............ regime do fornecedor (define se destaca IVA cheio)
 *   grauRepasse ....... 0 a 1 — quanto da desoneração/oneração é repassada ao preço
 *   atual ............. objeto do grossDown (para o cenário sem repasse)
 */
function aplicarIVA(cfg) {
  const ano = Number(cfg.ano) || 2027;
  const cronPadrao = parametrosDoAno(ano, cfg.parametrosIVA);
  // As telas de cadeia também precisam obedecer às regras salvas no projeto.
  // O cronograma do arquivo é somente a semente/fallback da calculadora avulsa.
  const parametrizado = cfg.parametrosIVA;
  const cron = parametrizado ? {
    ...cronPadrao,
    ...parametrizado,
    cbs: num(parametrizado.cbs),
    ibs: Number(parametrizado.calcular_ibs) === 1 ? num(parametrizado.ibs) : 0,
    fatorIcmsIss: num(parametrizado.fator_icms_iss),
    fatorPisCofins: num(parametrizado.fator_pis_cofins),
    fatorIpi: num(parametrizado.fator_ipi),
    compensavel: Number(parametrizado.compensavel) === 1,
  } : cronPadrao;
  const red = regras.reducao(cfg.reducao) || P.REDUCOES[cfg.reducao] || P.REDUCOES.integral;
  const regimeKey = cfg.regime || 'lucro_real';
  const regime = regimeConfigurado(regimeKey);

  let aliqCbs = cron.cbs * (1 - red.reducao);
  let aliqIbs = cron.ibs * (1 - red.reducao);

  if (red.especifico && cfg.aliqEspecifica !== undefined && cfg.aliqEspecifica !== null && cfg.aliqEspecifica !== '') {
    const total = num(cfg.aliqEspecifica);
    const proporcaoCbs = cron.cbs / (cron.cbs + cron.ibs || 1);
    aliqCbs = total * proporcaoCbs;
    aliqIbs = total - aliqCbs;
  }

  // Simples Nacional (sem opção pelo regime regular) continua no DAS:
  // não destaca IBS/CBS por fora — apenas transfere a parcela embutida.
  const destacaIVA = regime.geraCreditoNovo;

  const base = num(cfg.valorSemImposto);
  const cbs = destacaIVA ? base * aliqCbs : 0;
  const ibs = destacaIVA ? base * aliqIbs : 0;

  // Tributos antigos que ainda coexistem no ano.
  // Atenção: quem permanece no Simples/MEI continua recolhendo o DAS integral
  // durante toda a transição — os fatores de redução do ICMS/ISS/PIS/COFINS
  // não se aplicam a esse contribuinte, apenas ao regime regular.
  const at = cfg.atual ? cfg.atual.tributos : {};
  const noDas = !destacaIVA && ['simples_nacional', 'mei'].includes(regimeKey);
  const fIcmsIss = noDas ? 1 : cron.fatorIcmsIss;
  const fPisCofins = noDas ? 1 : cron.fatorPisCofins;
  const fIpi = noDas ? 1 : cron.fatorIpi;
  const icmsResidual = num(at.icms) * fIcmsIss;
  const issResidual = num(at.iss) * fIcmsIss;
  const pisCofinsResidual = (num(at.pis) + num(at.cofins)) * fPisCofins;
  const ipiResidual = num(at.ipi) * fIpi;
  const residual = icmsResidual + issResidual + pisCofinsResidual + ipiResidual;

  // Em 2026 o 1% pago é compensado com PIS/COFINS -> não onera
  const ivaEfetivo = cron.compensavel ? 0 : (cbs + ibs);

  // Preço final: base limpa + tributos residuais por dentro (recompostos) + IVA por fora
  // Cenário de repasse integral (grau = 1): fornecedor preserva a receita líquida.
  // Cenário sem repasse (grau = 0): fornecedor mantém o preço atual e absorve a diferença.
  const grau = cfg.grauRepasse === undefined ? 1 : Math.max(0, Math.min(1, num(cfg.grauRepasse)));
  const precoRepasseTotal = base + residual + ivaEfetivo;
  const precoAtual = cfg.atual ? cfg.atual.valorOperacao : precoRepasseTotal;
  const precoFinal = precoAtual + grau * (precoRepasseTotal - precoAtual);

  // O que o fornecedor efetivamente recebe (líquido de tributos sobre consumo)
  const receitaLiquidaFornecedor = precoFinal - residual - ivaEfetivo;

  return {
    ano, nota: cron.nota,
    aliquotas: { cbs: r4(aliqCbs), ibs: r4(aliqIbs), total: r4(aliqCbs + aliqIbs) },
    reducao: red.label, percentualReducao: red.reducao,
    destacaIVA,
    cbs: r2(cbs), ibs: r2(ibs), iva: r2(cbs + ibs), ivaEfetivo: r2(ivaEfetivo),
    residual: { icms: r2(icmsResidual), iss: r2(issResidual), pisCofins: r2(pisCofinsResidual), ipi: r2(ipiResidual), total: r2(residual) },
    valorSemImposto: r2(base),
    precoRepasseTotal: r2(precoRepasseTotal),
    precoFinal: r2(precoFinal),
    receitaLiquidaFornecedor: r2(receitaLiquidaFornecedor),
    totalTributos: r2(residual + ivaEfetivo),
    cargaEfetiva: precoFinal ? r4((residual + ivaEfetivo) / precoFinal) : 0,
    compensavel: !!cron.compensavel,
  };
}

// ---------------------------------------------------------------------------
// 4. CRÉDITO NOVO
// ---------------------------------------------------------------------------
function creditoNovo(novo, regimeFornecedor, regimeAdquirente, atual, op = {}) {
  const adq = regimeConfigurado(regimeAdquirente);
  const forn = regimeConfigurado(regimeFornecedor);
  const cron = parametrosDoAno(novo.ano, op.parametrosIVA);

  let cbs = 0, ibs = 0, residual = 0, obs = [];

  if (!adq.creditaNovo) {
    obs.push('Adquirente não se apropria de créditos de IBS/CBS (Simples Nacional no DAS, MEI, PF, órgão público ou imune).');
  } else if (!forn.geraCreditoNovo) {
    // Fornecedor no Simples/MEI: crédito limitado ao IBS/CBS embutido no DAS.
    // A referência CBS só é usada quando foi parametrizada explicitamente.
    const referenciaCbsSimples = num(op.creditoCbsSimplesReferencia);
    const embutido = (atual ? atual.totalTributos : 0) * 1.0;
    if (atual.regime === 'simples_nacional' && referenciaCbsSimples > 0) {
      cbs = novo.valorSemImposto * referenciaCbsSimples;
      obs.push('Crédito CBS estimado pela referência cadastrada do Simples (natureza: SIMULADO).');
    } else {
      const parcelaCbs = padraoConfigurado('cbs_no_das', 0.35);
      cbs = embutido * parcelaCbs; ibs = embutido * (1 - parcelaCbs);
      obs.push('Fornecedor optante pelo Simples/MEI: crédito limitado ao valor de IBS/CBS embutido no DAS — bem inferior ao crédito de um fornecedor do regime regular.');
    }
  } else {
    cbs = novo.cbs; ibs = novo.ibs;
  }

  // ICMS/ISS residuais ainda creditáveis conforme regras atuais
  if (adq.creditaAtual.icms && cron.fatorIcmsIss > 0) residual += novo.residual.icms;
  if (adq.creditaAtual.pisCofins && cron.fatorPisCofins > 0) residual += novo.residual.pisCofins;
  if (adq.creditaAtual.ipi && cron.fatorIpi > 0) residual += novo.residual.ipi;

  const total = cbs + ibs + residual;
  return { total: r2(total), detalhe: { cbs: r2(cbs), ibs: r2(ibs), residual: r2(residual) }, observacoes: obs };
}

// ---------------------------------------------------------------------------
// 5. CÁLCULO COMPLETO DE UMA OPERAÇÃO (usado pela calculadora e pelos lotes)
// ---------------------------------------------------------------------------
/**
 * @param {object} op  campos do grossDown +
 *   regimeAdquirente, reducao, aliqEspecifica, grauRepasse, anos[]
 */
function calcularOperacao(op) {
  const atual = grossDown(op);
  const regimeAdquirente = op.regimeAdquirente || 'lucro_real';
  const credAtual = creditoAtual(atual, regimeAdquirente);
  const custoAtual = r2(atual.valorOperacao - credAtual.total);

  const anos = (op.anos && op.anos.length ? op.anos : P.ANOS).map(Number);
  const projecao = anos.map((ano) => {
    const parametrosIVA = op.parametrosIVA && (op.parametrosIVA[ano] || op.parametrosIVA);
    const novo = aplicarIVA({
      valorSemImposto: atual.valorSemImposto, ano, reducao: op.reducao,
      aliqEspecifica: op.aliqEspecifica, regime: atual.regime,
      grauRepasse: op.grauRepasse, parametrosIVA, atual,
    });
    const cred = creditoNovo(novo, atual.regime, regimeAdquirente, atual, op);
    // No Simples a CBS não é acrescida ao preço por fora. Para fins de leitura
    // da compra, porém, exibimos a parcela transferível que compõe o crédito.
    // O preço projetado permanece inalterado porque essa parcela já está no DAS.
    if (atual.regime === 'simples_nacional' && num(op.creditoCbsSimplesReferencia) > 0 && novo.cbs === 0 && cred.detalhe.cbs > 0) {
      novo.cbs = cred.detalhe.cbs;
    }
    const custoEfetivo = r2(novo.precoFinal - cred.total);
    return {
      ...novo,
      credito: cred,
      custoEfetivo,
      variacaoCusto: r2(custoEfetivo - custoAtual),
      variacaoCustoPerc: custoAtual ? r4((custoEfetivo - custoAtual) / custoAtual) : 0,
      variacaoPreco: r2(novo.precoFinal - atual.valorOperacao),
      variacaoCarga: r4(novo.cargaEfetiva - atual.cargaEfetiva),
    };
  });

  return {
    atual: { ...atual, credito: credAtual, custoEfetivo: custoAtual, regimeAdquirente },
    projecao,
    resumo: montarResumo(atual, custoAtual, projecao),
  };
}

function montarResumo(atual, custoAtual, projecao) {
  const final = projecao[projecao.length - 1];
  const alertas = [];
  if (!final) return { alertas };

  if (final.variacaoCusto > 0.005 * (custoAtual || 1)) {
    alertas.push({ nivel: 'alto', texto: `Custo efetivo de aquisição aumenta ${fmtPerc(final.variacaoCustoPerc)} até ${final.ano}.` });
  } else if (final.variacaoCusto < -0.005 * (custoAtual || 1)) {
    alertas.push({ nivel: 'bom', texto: `Custo efetivo de aquisição reduz ${fmtPerc(Math.abs(final.variacaoCustoPerc))} até ${final.ano} pelo aproveitamento integral de crédito.` });
  }
  if (!final.destacaIVA) {
    alertas.push({ nivel: 'alto', texto: 'Fornecedor no Simples/MEI: crédito restrito ao embutido no DAS. Avaliar renegociação de preço, migração do fornecedor para o regime regular ou troca de fornecedor.' });
  }
  if (final.percentualReducao > 0) {
    alertas.push({ nivel: 'info', texto: `Operação enquadrada em ${final.reducao} — confirmar aderência do NCM/NBS e do cClassTrib antes de aplicar.` });
  }
  return {
    cargaAtual: atual.cargaEfetiva,
    cargaFinal: final.cargaEfetiva,
    deltaCarga: r4(final.cargaEfetiva - atual.cargaEfetiva),
    custoAtual, custoFinal: final.custoEfetivo,
    deltaCusto: final.variacaoCusto,
    alertas,
  };
}

const fmtPerc = (n) => `${(n * 100).toFixed(2).replace('.', ',')}%`;

module.exports = { grossDown, creditoAtual, resolverCreditoPisCofinsAdquirente, aplicarIVA, creditoNovo, calcularOperacao, r2, r4 };

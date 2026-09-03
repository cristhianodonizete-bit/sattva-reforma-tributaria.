/**
 * MOTOR DE PROJEÇÃO TRIBUTÁRIA E ECONÔMICA  (itens 9 a 33)
 * ---------------------------------------------------------------------------
 * Ordem obrigatória de processamento (item 25):
 *
 *   CLASSIFICAÇÃO → TRATAMENTO → BASE → ALÍQUOTA → TRIBUTO → CRÉDITO
 *
 * Nunca calcular antes de classificar.
 *
 * Alíquotas (item 28): lidas da tabela param_aliquotas, nunca fixadas no
 * código. Quando o valor ainda depende de definição legal, vem marcado como
 * ALÍQUOTA PARAMETRIZADA PARA SIMULAÇÃO.
 *
 * Natureza do dado (item 39): todo número carrega REAL, CALCULADO ou SIMULADO.
 */
const db = require('../db');
const { reconstruir, simplesEfetivo } = require('./reconstrucao');
const { resolverCreditoPisCofinsAdquirente } = require('./calculadora');
const { classificar } = require('./classificador');
const { CENARIOS_SIMULACAO } = require('../config/tabelasSimples');
const regras = require('../services/regras');
const bases = require('../services/basesReforma');
const resolvedorRegra = require('../services/resolvedorRegra');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

// ==========================================================================
// PARÂMETROS VINDOS DA BASE
// ==========================================================================
function aliquotasDoAno(ano) {
  const linha = db.prepare('SELECT * FROM param_aliquotas WHERE ano = ?').get(Number(ano));
  if (!linha) throw new Error(`Ano ${ano} não parametrizado. Cadastre-o em Parâmetros de alíquotas.`);
  return linha;
}
function anosDisponiveis() {
  return db.prepare('SELECT ano FROM param_aliquotas ORDER BY ano').all().map((x) => x.ano);
}
function anexosSimples() {
  const linhas = db.prepare('SELECT * FROM param_simples ORDER BY anexo, faixa').all();
  const out = {};
  for (const l of linhas) {
    if (!out[l.anexo]) out[l.anexo] = { nome: l.anexo_nome, tipo: l.tipo, faixas: [] };
    out[l.anexo].faixas.push([l.faixa, l.limite, l.aliquota_nominal, l.parcela_deduzir, {
      irpj: l.rep_irpj, csll: l.rep_csll, cofins: l.rep_cofins, pis: l.rep_pis,
      cpp: l.rep_cpp, icms_iss: l.rep_icms_iss, ipi: l.rep_ipi || 0,
    }]);
  }
  return out;
}

/** Alíquota efetiva de IBS e CBS depois do tratamento tributário */
function aliquotasEfetivas(ano, cls) {
  const p = aliquotasDoAno(ano);
  const ibsAtivo = Number(p.calcular_ibs) === 1;
  let ibs = ibsAtivo ? num(p.ibs) : 0, cbs = num(p.cbs);
  const trilha = [{ etapa: 'alíquota de referência', ibs: r6(ibs), cbs: r6(cbs), origem: `param_aliquotas ${ano}` }];

  // Redução vinda da base (item 27): percentual próprio por tributo quando existir
  const rIbs = cls.reducaoIbs != null ? cls.reducaoIbs : reducaoPorChave(cls.reducao);
  const rCbs = cls.reducaoCbs != null ? cls.reducaoCbs : reducaoPorChave(cls.reducao);
  if (rIbs || rCbs) {
    ibs *= (1 - rIbs); cbs *= (1 - rCbs);
    trilha.push({ etapa: 'redução aplicada', reducaoIbs: rIbs, reducaoCbs: rCbs,
      ibs: r6(ibs), cbs: r6(cbs), origem: cls.origemRegra });
  }
  const semIncidencia = ['imune'].includes(cls.reducao) || String(cls.cst || '').startsWith('4');
  if (semIncidencia) {
    ibs = 0; cbs = 0;
    trilha.push({ etapa: 'sem incidência', ibs: 0, cbs: 0, origem: cls.tratamento || cls.origemRegra });
  }
  return {
    ibs: r6(ibs), cbs: r6(cbs), total: r6(ibs + cbs),
    reducaoIbs: rIbs, reducaoCbs: rCbs,
    aliquotaReferencia: { ibs: ibsAtivo ? num(p.ibs) : 0, cbs: num(p.cbs) },
    simulacao: !!p.simulacao,
    rotulo: p.simulacao ? 'ALÍQUOTA PARAMETRIZADA PARA SIMULAÇÃO' : 'alíquota parametrizada',
    trilha, parametros: p,
  };
}

/** Percentual de redução vindo da tabela param_reducoes, editável */
function reducaoPorChave(chave) {
  return regras.percentualReducao(chave);
}

// ==========================================================================
// CRÉDITO
// ==========================================================================
/**
 * Determina o direito ao crédito do adquirente (item 31).
 * Retorna sempre um status, nunca um crédito "certo" quando há dúvida.
 */
function regimeCbs(regime) {
  if (['lucro_real', 'lucro_presumido', 'regime_regular'].includes(regime)) return 'REGULAR';
  if (regime === 'simples_nacional') return 'SIMPLES_DAS';
  if (regime === 'simples_regime_regular') return 'SIMPLES_REGIME_REGULAR';
  if (regime === 'mei') return 'MEI';
  if (['produtor_rural_pf', 'imune_isento', 'orgao_publico', 'pessoa_fisica'].includes(regime)) return 'NAO_CONTRIBUINTE';
  return 'INDETERMINADO';
}
function credito(legado, tipoCredito, modalidadeCredito, statusDeterminacao, motivo) {
  return { status: legado, tipoCredito, modalidadeCredito, statusDeterminacao, motivo };
}
function memoriaElegibilidadeSimples({ sentido, regimeEmitente, regimeAdquirente, cls, item, ano }) {
  if (sentido !== 'entrada' || regimeEmitente !== 'simples_nacional' || !['lucro_real', 'lucro_presumido', 'regime_regular'].includes(regimeAdquirente)) return null;
  const resposta = resolvedorRegra.resolver({
    tipo_operacao: 'AQUISICAO', direcao: 'ENTRADA', data: `${Number(ano) || 2027}-01-01`,
    fornecedor: { regime: regimeEmitente }, adquirente: { regime: regimeAdquirente },
    operacao_entrada: true, fornecedor_simples: true, adquirente_regular: true,
    aquisicao_abrangida: !cls.vedacaoPossivel, documento_fiscal: Boolean(item.documento),
    fornecedor_mei: false, adquirente_simples: false,
  });
  return {
    regra_id: resposta.regra?.id || null, regra_versao: resposta.regra?.versao || null,
    fundamento_legal: resposta.regra?.fundamento_legal || null,
    vigencia: resposta.regra?.vigencia_inicio || null,
    fornecedor_simples: 'SIM', adquirente_regular: 'SIM',
    elegibilidade_credito: resposta.status === 'DETERMINADO' ? 'DETERMINADA' : resposta.status,
    pendencias: resposta.pendencias || [], origem_regra: resposta.origem,
  };
}
function classificacaoBloqueiaCredito(cls, decisaoClassificatoria = null) {
  if (cls.vedacaoPossivel) return true;
  if (cls.status === 'SEM_CORRESPONDENCIA') return true;
  if (cls.status !== 'REQUER_VALIDACAO') return false;

  // A classificação bruta pode permanecer pendente quando existem candidatos
  // equivalentes para os efeitos materiais da operação. A liberação só ocorre
  // com decisão explícita e rastreável; B2B, saída ou regime do cliente nunca
  // substituem essa evidência classificatória.
  const decisao = decisaoClassificatoria || {};
  const autonomia = String(decisao.autonomiaClassificatoria || '').toUpperCase();
  const impactoNaoMaterial = decisao.impactoTributarioMaterial === false;
  const classificacaoSuficiente = decisao.classificacaoFiscalmenteEquivalente === true
    || ['DETERMINADA', 'PARCIAL'].includes(autonomia);
  return !(impactoNaoMaterial && classificacaoSuficiente);
}

// A classificação parcial é suficiente apenas quando o comparador demonstrou
// que todos os candidatos têm o mesmo efeito material. A chave LC116 vem do
// fato original normalizado; nenhuma NBS/NCM candidata é escolhida aqui.
function contextoAposEquivalencia(item, cls, decisaoExterna = null) {
  const equivalencia = cls?.equivalenciaFiscal || null;
  const equivalente = equivalencia?.status === 'EQUIVALENTE_FISCALMENTE'
    && equivalencia.impacto_tributario_material === false;
  const decisao = {
    ...(decisaoExterna || {}),
    ...(equivalente ? {
      impactoTributarioMaterial: false,
      classificacaoFiscalmenteEquivalente: true,
      autonomiaClassificatoria: 'PARCIAL',
      regraEquivalencia: equivalencia.regra,
      hashDecisao: equivalencia.hash_decisao,
    } : {}),
  };
  if (!equivalente) return { item, decisao, equivalente: false, equivalencia: null };
  return {
    item: {
      ...item,
      // O resolvedor fiscal compara os candidatos e só consome regra quando
      // a assinatura própria de PIS/Cofins também é conclusiva.
      lc116: item.lc116 || bases.normLc116(item.cst),
      equivalencia_classificatoria: equivalencia,
    },
    decisao,
    equivalente: true,
    equivalencia,
  };
}

function avaliarCredito({ regimeAdquirente, regimeFornecedor, cls, sentido, simplesFornecedorConhecido = false, simplesFornecedorReferencia = null, decisaoClassificatoria = null }) {
  // Regime do adquirente desconhecido não pode ser tratado como se creditasse:
  // isso superestimaria o crédito entregue ao cliente. O desconhecido tem que
  // continuar desconhecido — e virar apontamento, não número otimista.
  if (!regimeAdquirente) {
    return credito('DADOS_INSUFICIENTES', null, null, 'INDETERMINADO', 'Regime do adquirente desconhecido — não é possível afirmar que ele aproveita o crédito.');
  }
  // Quem credita e quem gera crédito é definido na tabela param_regimes
  const rAdq = regras.regime(regimeAdquirente);
  if (rAdq && !rAdq.creditaNovo) {
    return credito('SEM_DIREITO', 'SEM_CREDITO', null, 'DETERMINADO', `Adquirente em ${regimeAdquirente} não apura IBS/CBS pelo regime regular — sem apropriação de crédito.`);
  }
  // O regime MEI resolve o crédito ordinário como zero. Uma classificação
  // documental incompleta não pode abrir pendência quando ela não altera esse
  // resultado; só uma hipótese explícita de crédito presumido exige analisar
  // a classificação material da operação.
  if (regimeFornecedor === 'mei' && cls.creditoPresumido !== true) {
    return credito('SEM_DIREITO', 'SEM_CREDITO', null, 'DETERMINADO', 'Fornecedor MEI: não há crédito CBS ordinário; não foi identificada hipótese legal específica de crédito presumido.');
  }
  if (cls.vedacaoPossivel) {
    return credito('SUJEITO_VALIDACAO', null, null, 'SUJEITO_VALIDACAO', 'Aquisição possivelmente de uso e consumo ou ativo — confirmar se há vedação ao crédito.');
  }
  if (cls.status === 'REQUER_VALIDACAO' && classificacaoBloqueiaCredito(cls, decisaoClassificatoria)) {
    return credito('SUJEITO_VALIDACAO', null, null, 'SUJEITO_VALIDACAO', 'Classificação do item ainda não concluída — crédito depende do enquadramento definitivo.');
  }
  if (cls.status === 'SEM_CORRESPONDENCIA') {
    return credito('DADOS_INSUFICIENTES', null, null, 'INDETERMINADO', 'Item sem correspondência nas bases — não é possível projetar o crédito.');
  }
  if (!regimeFornecedor) {
    return credito('DADOS_INSUFICIENTES', null, null, 'INDETERMINADO', 'Regime do fornecedor desconhecido — o crédito depende de como ele apura IBS/CBS.');
  }
  const rForn = regras.regime(regimeFornecedor);
  if (regimeFornecedor === 'simples_nacional') {
    if (Number(simplesFornecedorReferencia) > 0) return credito('PROJETADO_LIMITADO', 'SIMPLES', 'LIMITADO_CBS_SIMPLES', 'DETERMINADO_POR_PREMISSA', 'Crédito CBS estimado pela premissa cadastrada para fornecedor do Simples; resultado simulado.');
    if (!simplesFornecedorConhecido) return credito('DADOS_INSUFICIENTES', 'SIMPLES', 'LIMITADO_CBS_SIMPLES', 'INDETERMINADO', 'Fornecedor do Simples sem faixa ou alíquota efetiva determinada — crédito não é zero, mas permanece indeterminado.');
    return credito('PROJETADO_LIMITADO', 'SIMPLES', 'LIMITADO_CBS_SIMPLES', 'DETERMINADO', 'Crédito limitado ao CBS efetivamente gerado dentro do Simples.');
  }
  if (regimeFornecedor === 'mei') {
    if (cls.creditoPresumido === true) return credito('CREDITO_PRESUMIDO', 'PRESUMIDO', 'HIPOTESE_LEGAL', 'DETERMINADO', 'Hipótese legal específica de crédito presumido identificada na operação.');
    return credito('SEM_DIREITO', 'SEM_CREDITO', null, 'DETERMINADO', 'MEI não gera crédito presumido automaticamente; não foi identificada hipótese legal específica.');
  }
  if (rForn && !rForn.geraCreditoNovo) return credito('SEM_DIREITO', 'SEM_CREDITO', null, 'DETERMINADO', 'Fornecedor não gera crédito CBS nesta operação.');
  return credito('PROJETADO', 'NORMAL', 'INTEGRAL', 'DETERMINADO', 'Fornecedor do regime regular: crédito CBS da operação elegível.');
}


/**
 * Mercadoria ou serviço?
 * Não basta olhar o NCM: itens vindos do registro C190 do SPED (perfil B) e
 * de totalizadores não trazem NCM e ainda assim são mercadoria com ICMS
 * destacado. Decidir só pelo NCM faria o ICMS ser ignorado na reconstrução da
 * base econômica — o preço voltaria "limpo" com o imposto ainda dentro.
 */
function naturezaItem(item) {
  if (num(item.iss) > 0 || item.nbs) return 'servico';
  if (item.ncm || num(item.icms) > 0 || num(item.icms_st) > 0 || num(item.ipi) > 0) return 'mercadoria';
  const cfop = String(item.cfop || '');
  if (/^[1-6]/.test(cfop)) return 'mercadoria';
  return 'servico';
}

// ==========================================================================
// PROJEÇÃO DE UM ITEM
// ==========================================================================
/**
 * @param {object} item     movimento normalizado (valores originais)
 * @param {object} ctx      { empresa, sentido, ano, regimeContraparte, perfilDestinatario,
 *                            simplesFornecedor, simplesEmpresa, hibrido }
 */
function projetarItem(item, ctx) {
  const sentido = ctx.sentido === 'saida' ? 'saida' : 'entrada';
  const ano = Number(ctx.ano) || 2027;
  const tipo = naturezaItem(item);

  // Quem EMITE a nota e quem RECEBE
  const regimeEmitente = sentido === 'entrada' ? ctx.regimeContraparte : (ctx.empresa && ctx.empresa.regime);
  const regimeAdquirente = sentido === 'entrada' ? (ctx.empresa && ctx.empresa.regime) : ctx.regimeContraparte;

  // ---------- 1. CLASSIFICAÇÃO (sempre antes do cálculo) ----------
  const cls = classificar(item, { empresa: ctx.empresa, sentido, regimeContraparte: ctx.regimeContraparte,
    perfilDestinatario: ctx.perfilDestinatario, elegibilidadeAnexoXi: ctx.elegibilidadeAnexoXi });
  const contextoClassificatorio = contextoAposEquivalencia(item, cls, ctx.decisaoClassificatoria || null);

  // ---------- 2. BASE ECONÔMICA ----------
  const simplesInfo = ctx.simplesEmitente || null;

  // ---------- 3. ALÍQUOTA E CONTEXTO DA BASE ----------
  const aliq = aliquotasEfetivas(ano, cls);
  // Para emitente regular, a regra geral versionada entra após documento,
  // exceção específica e referência fiscal. Ela saneia XML sem PIS/COFINS
  // confiável; não substitui monofasia, alíquota zero ou regra específica.
  const regraGeralRegimeConfirmada = ['lucro_presumido', 'lucro_real'].includes(regimeEmitente)
    && contextoClassificatorio.item?.condicao_material_pendente !== true;
  const rec = reconstruir({ ...contextoClassificatorio.item, tipo, regime: regimeEmitente, simples: simplesInfo,
    regra_geral_regime_confirmada: regraGeralRegimeConfirmada }, {
    ibsHabilitado: Number(aliq.parametros.calcular_ibs) === 1,
  });
  if (contextoClassificatorio.equivalente) {
    rec.equivalenciaClassificatoria = {
      regra: contextoClassificatorio.equivalencia.regra,
      catalogo_versoes: contextoClassificatorio.equivalencia.catalogo_versoes,
      hash_decisao: contextoClassificatorio.equivalencia.hash_decisao,
      origem: contextoClassificatorio.equivalencia.origem,
    };
  }

  // ---------- 4. TRIBUTO ----------
  // Optante do Simples que NÃO migrou para o regime regular não destaca
  // IBS/CBS por fora: continua recolhendo pelo DAS.
  const regEmit = regras.regime(regimeEmitente);
  const emitenteNoDas = !!(regEmit && regEmit.noDas) && !ctx.hibrido;
  let ibs = 0, cbs = 0, natureza = 'CALCULADO';

  // A referência CBS do Simples é uma premissa operacional explícita para
  // compras. Ela não substitui um percentual efetivo que esteja documentado
  // ou determinado para a operação. Não confundir com o fallback de
  // PIS/COFINS atual, que é usado apenas na reconstrução da carga vigente.
  const referenciaCreditoSimples = sentido === 'entrada' && regimeEmitente === 'simples_nacional'
    ? Number(regras.regime(regimeEmitente)?.creditoCbsSimplesReferencia) || 0 : 0;
  if (emitenteNoDas) {
    if (simplesInfo && simplesInfo.aliquotaEfetiva) {
      // parcela do DAS que corresponde a IBS (ICMS/ISS) e CBS (PIS/COFINS)
      const rep = simplesInfo.reparticao || {};
      cbs = rec.baseEconomica * simplesInfo.aliquotaEfetiva * (num(rep.pis) + num(rep.cofins));
      ibs = rec.baseEconomica * simplesInfo.aliquotaEfetiva * num(rep.icms_iss);
      natureza = simplesInfo.origem === 'faturamento conhecido' ? 'CALCULADO' : 'SIMULADO';
    } else if (referenciaCreditoSimples > 0) {
      cbs = rec.baseEconomica * referenciaCreditoSimples;
      natureza = 'SIMULADO';
    } else {
      natureza = 'SIMULADO';
    }
  } else {
    ibs = rec.baseEconomica * aliq.ibs;
    cbs = rec.baseEconomica * aliq.cbs;
    if (aliq.simulacao || rec.status === 'estimada') natureza = 'SIMULADO';
  }
  // Fase CBS: mesmo no Simples, a parcela de IBS não integra a simulação até
  // ser habilitada expressamente na parametrização do ano.
  if (Number(aliq.parametros.calcular_ibs) !== 1) ibs = 0;

  // ---------- 5. CRÉDITO ----------
  const percentualEfetivoSimples = !!(simplesInfo && simplesInfo.aliquotaEfetiva);
  const cred = avaliarCredito({
    regimeAdquirente, regimeFornecedor: regimeEmitente, cls, sentido,
    decisaoClassificatoria: contextoClassificatorio.decisao,
    simplesFornecedorConhecido: percentualEfetivoSimples,
    // O status de crédito deve registrar DETERMINADO quando a operação traz o
    // percentual efetivo. A premissa só é enviada quando foi realmente usada.
    simplesFornecedorReferencia: percentualEfetivoSimples ? null : referenciaCreditoSimples,
  });
  if (!classificacaoBloqueiaCredito(cls, contextoClassificatorio.decisao)
    && contextoClassificatorio.equivalente) {
    cred.decisaoClassificatoria = {
      impacto_tributario_material: false,
      classificacao_fiscalmente_equivalente: true,
      autonomia_classificatoria: 'PARCIAL',
      origem: contextoClassificatorio.equivalencia.regra,
      hash_decisao: contextoClassificatorio.equivalencia.hash_decisao,
    };
  }
  const elegibilidadeSimples = memoriaElegibilidadeSimples({ sentido, regimeEmitente, regimeAdquirente, cls, item, ano });
  if (elegibilidadeSimples) {
    cred.elegibilidadeLegal = elegibilidadeSimples;
    cred.percentualCreditoOrigem = percentualEfetivoSimples ? 'DOCUMENTO_OU_FAIXA_EFETIVA'
      : referenciaCreditoSimples > 0 ? 'PARAMETRO_CREDITO_SIMPLES' : 'PERCENTUAL_NAO_DETERMINADO';
    cred.origem = cred.percentualCreditoOrigem;
    cred.natureza = percentualEfetivoSimples ? 'CALCULADO'
      : referenciaCreditoSimples > 0 ? 'SIMULADO' : 'INDETERMINADO';
  }
  let creditoIbs = 0, creditoCbs = 0;
  if (['PROJETADO', 'PROJETADO_LIMITADO'].includes(cred.status)) { creditoIbs = ibs; creditoCbs = cbs; }
  const creditoPisCofinsAdquirente = sentido === 'entrada'
    ? resolverCreditoPisCofinsAdquirente({
      regimeAdquirente,
      regraEspecificaCredito: item.regra_credito_pis_cofins || null,
      referenciaFiscal: item.referencia_credito_pis_cofins || null,
    })
    : null;
  // CREDITO_PRESUMIDO fica em zero até que a hipótese seja informada como
  // premissa — o sistema sinaliza a possibilidade, não a arbitra.

  const precoProjetado = emitenteNoDas
    ? rec.precoMercadoria                      // no DAS o preço não recebe IVA por fora
    : rec.baseEconomica + ibs + cbs;
  const custoLiquido = precoProjetado - creditoIbs - creditoCbs;

  return {
    // rastreabilidade (item 40)
    documento: item.documento || '', item_numero: item.item_numero || null,
    contraparte: item.nome || '', cnpj: item.inscr_federal || '',
    descricao: item.descricao || '', ncm: item.ncm || '', nbs: item.nbs || '',
    cfop: item.cfop || '', cstAtual: item.cst || '', csosn: item.csosn || '',
    quantidade: num(item.quantidade) || null,
    sentido, ano, tipo,
    regimeEmitente, regimeAdquirente,
    perfilDestinatario: ctx.perfilDestinatario || null,

    precoAtual: rec.precoAtual,
    baseEconomica: rec.baseEconomica,
    reconstrucao: rec,

    classificacao: cls,
    aliquotas: aliq,

    ibs: r2(ibs), cbs: r2(cbs), totalIvA: r2(ibs + cbs),
    creditoIbs: r2(creditoIbs), creditoCbs: r2(creditoCbs), creditoTotal: r2(creditoIbs + creditoCbs),
    credito: cred,
    creditoPisCofinsAdquirente,
    regimeCbsEmitente: regimeCbs(regimeEmitente), regimeCbsAdquirente: regimeCbs(regimeAdquirente),
    precoProjetado: r2(precoProjetado),
    custoLiquido: r2(custoLiquido),
    emitenteNoDas,
    simples: simplesInfo,
    natureza,
    cargaProjetada: precoProjetado ? r6((ibs + cbs) / precoProjetado) : 0,
  };
}

// ==========================================================================
// CENÁRIOS DO SIMPLES (itens 12 e 13)
// ==========================================================================
/**
 * Quando o fornecedor é do Simples e o faturamento é desconhecido, projeta o
 * item em 5 faixas representativas — nunca uma alíquota única.
 */
function cenariosSimples(item, ctx) {
  const tabelas = anexosSimples();
  const anexo = ctx.anexo || (item.ncm ? 'I' : 'III');
  const cenarios = CENARIOS_SIMULACAO.map((c) => {
    const s = simplesEfetivo(anexo, c.rbt12, tabelas);
    if (!s) return null;
    s.origem = 'faixa simulada';
    const p = projetarItem(item, { ...ctx, simplesEmitente: s });
    return {
      faixa: c.faixa, rotulo: c.rotulo, rbt12: c.rbt12,
      anexo: s.anexo, aliquotaEfetiva: s.aliquotaEfetiva, formula: s.formula,
      ibs: p.ibs, cbs: p.cbs,
      creditoIbs: p.creditoIbs, creditoCbs: p.creditoCbs, creditoTotal: p.creditoTotal,
      custoLiquido: p.custoLiquido, precoProjetado: p.precoProjetado,
      natureza: 'SIMULADO',
    };
  }).filter(Boolean);

  // Cenário híbrido (item 13): IBS/CBS apurados pelo regime regular
  const hibrido = projetarItem(item, { ...ctx, hibrido: true, simplesEmitente: null });

  return {
    rotulo: 'CRÉDITO POTENCIAL ESTIMADO POR FAIXA DO SIMPLES',
    natureza: 'SIMULADO',
    anexo, cenarios,
    hibrido: {
      rotulo: 'CENÁRIO SIMULADO — IBS/CBS pelo regime regular (híbrido)',
      ibs: hibrido.ibs, cbs: hibrido.cbs, creditoTotal: hibrido.creditoTotal,
      custoLiquido: hibrido.custoLiquido, precoProjetado: hibrido.precoProjetado,
      natureza: 'SIMULADO',
      observacao: 'Não se assume que o fornecedor fará essa opção. É comparação econômica.',
    },
    amplitude: cenarios.length ? {
      creditoMin: Math.min(...cenarios.map((c) => c.creditoTotal)),
      creditoMax: Math.max(...cenarios.map((c) => c.creditoTotal)),
      custoMin: Math.min(...cenarios.map((c) => c.custoLiquido)),
      custoMax: Math.max(...cenarios.map((c) => c.custoLiquido)),
    } : null,
  };
}

// ==========================================================================
// PERFIL DO DESTINATÁRIO (item 17)
// ==========================================================================
function classificarDestinatario(parceiro) {
  const regime = parceiro && parceiro.regime;
  const cnpj = String((parceiro && parceiro.cnpj) || '');
  if (regime === 'orgao_publico') return { perfil: 'governo', detalhe: 'Órgão ou entidade pública', credita: false };
  if (regime === 'pessoa_fisica' || cnpj.length === 11) return { perfil: 'b2c_pf', detalhe: 'Pessoa física consumidora final', credita: false };
  if (!regime) return { perfil: 'requer_validacao', detalhe: 'Regime do destinatário desconhecido', credita: null };
  // 'regime_regular' é o enquadramento usado quando se sabe que a contraparte
  // está FORA do Simples mas não se distingue Real de Presumido — que é o que
  // o XML e o cadastro público da Receita permitem afirmar. Para IBS/CBS os
  // três se comportam igual: apuram pelo regime regular e creditam.
  if (['lucro_real', 'lucro_presumido', 'simples_regime_regular', 'regime_regular'].includes(regime)) {
    return { perfil: 'b2b', detalhe: 'Pessoa jurídica do regime regular', credita: true, regime };
  }
  if (['simples_nacional', 'mei'].includes(regime)) {
    return { perfil: 'b2b', detalhe: 'Pessoa jurídica optante pelo Simples (sem apropriação no DAS)', credita: false, regime };
  }
  if (['imune_isento'].includes(regime)) return { perfil: 'b2c_pj', detalhe: 'Entidade imune/isenta — sem apropriação de crédito', credita: false };
  return { perfil: 'requer_validacao', detalhe: 'Perfil não determinado', credita: null };
}

// ==========================================================================
// SENSIBILIDADE AO CRÉDITO (item 23)
// ==========================================================================
/**
 * Indica a IMPORTÂNCIA POTENCIAL DO CRÉDITO para o cliente. É projeção
 * econômica — não afirma que o cliente vai exigir crédito.
 */
function sensibilidadeCredito({ perfil, credita, credito, projecao }) {
  if (perfil === 'requer_validacao' || credita === null) {
    return { nivel: 'REQUER_VALIDACAO', leitura: 'Regime do destinatário desconhecido — não é possível projetar a relevância do crédito.' };
  }
  if (!credita) {
    return { nivel: 'NAO_APLICAVEL',
      leitura: perfil === 'governo'
        ? 'Ente público não se apropria de IBS/CBS. O crédito não é argumento comercial aqui; o preço cheio é.'
        : 'Destinatário sem direito a crédito: sente o preço integral. A negociação se dá sobre o preço final, não sobre o preço líquido.' };
  }
  if (credito && ['SUJEITO_VALIDACAO', 'DADOS_INSUFICIENTES'].includes(credito.status)) {
    return { nivel: 'REQUER_VALIDACAO', leitura: credito.motivo };
  }
  const proporcao = projecao && projecao.precoProjetado
    ? (projecao.creditoTotal / projecao.precoProjetado) : 0;
  const limiteAlta = regras.limiar('sensibilidade_alta', 0.15);
  const limiteMedia = regras.limiar('sensibilidade_media', 0.07);
  if (proporcao >= limiteAlta) {
    return { nivel: 'ALTA', proporcao: r6(proporcao),
      leitura: `O crédito representa ${(proporcao * 100).toFixed(1)}% do preço projetado. Para este cliente, o preço relevante passa a ser o líquido de crédito — e um concorrente que não gere crédito integral fica em desvantagem visível.` };
  }
  if (proporcao >= limiteMedia) {
    return { nivel: 'MEDIA', proporcao: r6(proporcao),
      leitura: `O crédito representa ${(proporcao * 100).toFixed(1)}% do preço projetado. Relevante na comparação entre fornecedores, mas não determinante isoladamente.` };
  }
  return { nivel: 'BAIXA', proporcao: r6(proporcao),
    leitura: 'A parcela creditável é pequena diante do preço. O crédito pesa pouco na decisão econômica deste cliente.' };
}

// ==========================================================================
// COMPARADOR DE CLIENTES (item 24)
// ==========================================================================
function compararPerfis(item, ctx) {
  const perfis = [
    { chave: 'lucro_real', rotulo: 'Cliente Lucro Real' },
    { chave: 'lucro_presumido', rotulo: 'Cliente Lucro Presumido' },
    { chave: 'simples_nacional', rotulo: 'Cliente Simples Nacional' },
    { chave: 'pessoa_fisica', rotulo: 'Consumidor pessoa física' },
    { chave: 'orgao_publico', rotulo: 'Governo' },
  ];
  return perfis.map((p) => {
    const d = classificarDestinatario({ regime: p.chave, cnpj: p.chave === 'pessoa_fisica' ? '00000000000' : '' });
    const proj = projetarItem(item, { ...ctx, sentido: 'saida', regimeContraparte: p.chave, perfilDestinatario: d.perfil });
    const sens = sensibilidadeCredito({ perfil: d.perfil, credita: d.credita, credito: proj.credito, projecao: proj });
    return {
      perfil: p.chave, rotulo: p.rotulo, classificacao: d.perfil, detalhe: d.detalhe,
      ibs: proj.ibs, cbs: proj.cbs, precoProjetado: proj.precoProjetado,
      creditoTotal: proj.creditoTotal, custoLiquido: proj.custoLiquido,
      sensibilidade: sens.nivel, leitura: sens.leitura,
    };
  });
}

// ==========================================================================
// APURAÇÃO SIMULADA (item 32) — IBS e CBS jamais se compensam entre si
// ==========================================================================
function apurar(saidas, entradas) {
  const debIbs = saidas.reduce((s, x) => s + num(x.ibs), 0);
  const debCbs = saidas.reduce((s, x) => s + num(x.cbs), 0);
  const creIbs = entradas.reduce((s, x) => s + num(x.creditoIbs), 0);
  const creCbs = entradas.reduce((s, x) => s + num(x.creditoCbs), 0);
  const saldoIbs = debIbs - creIbs;
  const saldoCbs = debCbs - creCbs;
  return {
    ibs: { debitos: r2(debIbs), creditos: r2(creIbs), saldo: r2(saldoIbs) },
    cbs: { debitos: r2(debCbs), creditos: r2(creCbs), saldo: r2(saldoCbs) },
    cargaLiquida: r2(saldoIbs + saldoCbs),
    observacao: 'IBS e CBS são apurados separadamente. Saldo credor de um não compensa débito do outro.',
  };
}

/** Carga atual identificada nos documentos (item 33) — sem inventar tributo ausente */
function cargaAtual(itens) {
  const soma = (c) => itens.reduce((s, x) => s + num(x.reconstrucao && x.reconstrucao.tributosAtuais[c]), 0);
  const icms = soma('icms'), iss = soma('iss'), ipi = soma('ipi');
  const pis = soma('pis'), cofins = soma('cofins'), st = soma('icms_st');
  const estimados = itens.filter((x) => x.reconstrucao && x.reconstrucao.estimado).length;
  return {
    icms: r2(icms), iss: r2(iss), ipi: r2(ipi), pis: r2(pis), cofins: r2(cofins), icms_st: r2(st),
    total: r2(icms + iss + ipi + pis + cofins + st),
    itensComValorEstimado: estimados,
    observacao: estimados
      ? `${estimados} itens tiveram algum tributo estimado por alíquota de regime — o documento não trazia o destaque.`
      : 'Todos os valores vieram dos documentos.',
  };
}

module.exports = {
  naturezaItem, projetarItem, cenariosSimples, classificarDestinatario, sensibilidadeCredito, regimeCbs,
  compararPerfis, apurar, cargaAtual, aliquotasEfetivas, aliquotasDoAno, anosDisponiveis, classificacaoBloqueiaCredito,
  anexosSimples, avaliarCredito, contextoAposEquivalencia,
};

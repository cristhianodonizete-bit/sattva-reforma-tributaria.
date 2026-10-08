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
function somenteDigitos(valor) { return String(valor || '').replace(/\D/g, ''); }
function ehPlanoAssistenciaSaude(item = {}, cls = {}) {
  return somenteDigitos(cls.cclasstrib) === '011002'
    || somenteDigitos(item.nbs) === '109101000'
    || item.planoSaude === true;
}

function ehContribuicaoAssociativaPresumida(item = {}) {
  const chave = String(item.entradaManual?.itemChave || item.itemChave || '');
  const semDocumentoFiscal = !String(item.documento || '').trim();
  const semServicoIdentificado = !somenteDigitos(item.nbs) && !somenteDigitos(item.lc116);
  return chave === '3_7_03_015_022_ENTIDADES_E_ASSOCIACOES'
    && semDocumentoFiscal && semServicoIdentificado;
}

// A conta contábil "Legais e judiciais" é mais ampla do que honorários:
// também comporta custas, taxas públicas, depósitos e reembolsos. A redução
// do art. 127 só nasce da seleção expressa da natureza técnica de advocacia;
// nunca da conta ampla ou de uma palavra solta no histórico.
function ehHonorarioAdvocaticioArt127(item = {}) {
  const chave = String(item.entradaManual?.itemChave || item.itemChave || '');
  return chave === 'HONORARIOS_ADVOCATICIOS_ART_127';
}

function memoriaHonorarioAdvocaticio(item = {}) {
  if (!ehHonorarioAdvocaticioArt127(item)) return null;
  return {
    rotulo: 'Projeção de honorários advocatícios — art. 127',
    premissa: 'Serviço efetivamente prestado por escritório de advocacia, selecionado no catálogo técnico. O atendimento aos requisitos do art. 127 permanece hipótese explícita quando não documentado.',
    cst: '200',
    cclasstrib: '200052',
    reducao_aliquota: 0.30,
    fundamento: 'LC 214/2025, arts. 47 e 127; Decreto 12.955/2026, art. 202.',
    aviso: 'Projeção realizada sob a hipótese de serviço advocatício elegível ao art. 127. Custas judiciais, taxas públicas, depósitos judiciais e reembolsos não se enquadram nesta natureza.',
  };
}

function textoFiscalNormalizado(...valores) {
  return valores.join(' ').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Taxas públicas, custas e depósitos judiciais são desembolsos sem uma
// prestação de serviço individualizada. Não podem ser convertidos em crédito
// pela natureza contábil que os recebeu. A regra legada exige evidência no
// Razão: nunca usa apenas o nome da conta para substituir um fornecedor.
function ehCustaTaxaOuDepositoJudicial(item = {}) {
  const chave = String(item.entradaManual?.itemChave || item.itemChave || '');
  if (chave === 'CUSTAS_TAXAS_DEPOSITOS_JUDICIAIS') return true;
  const texto = textoFiscalNormalizado(item.historico, item.descricao, item.conta);
  if (chave === '3_7_03_015_005_LEGAIS_E_JUDICIAIS') {
    return /\b(CUSTAS?|TAXAS?\s+JUDICIAIS?|DEPOSITO\s+JUDICIAL|TRIBUNAL\s+DA\s+JUSTICA|RECURSAL)\b/.test(texto);
  }
  if (chave === '3_7_03_011_008_IPTU_E_TAXAS') {
    return /\b(IPTU|TRIBUTOS?\s+MUNICIPAIS?|PREFEITURA|TAXAS?\s+PUBLICAS?)\b/.test(texto);
  }
  return false;
}

function memoriaCustaTaxaOuDepositoJudicial(item = {}) {
  if (!ehCustaTaxaOuDepositoJudicial(item)) return null;
  return {
    status: 'Projeção concluída — taxa pública, custa ou depósito judicial sem operação tributada identificada.',
    premissa: 'O histórico do Razão identifica desembolso perante poder público ou Judiciário, sem serviço individualizado do fornecedor.',
    valor_despesa: r2(num(item.valor)),
    credito_pis_cofins: 0,
    credito_cbs: 0,
    cbs: 0,
    fundamento: 'A despesa permanece na análise financeira, mas não é tratada como honorário advocatício ou prestação de serviço tributada sem documento fiscal correspondente.',
    reclassificar_quando_servico_identificado: true,
  };
}

function memoriaContribuicaoAssociativa(item = {}) {
  if (!ehContribuicaoAssociativaPresumida(item)) return null;
  return {
    status: 'Projeção concluída — contribuição associativa presumida; classificação fiscal pendente.',
    premissa: 'Mensalidade ou contribuição associativa sem contraprestação individualizada, adotada exclusivamente para a projeção.',
    valor_despesa: r2(num(item.valor)),
    credito_pis_cofins: 0,
    credito_cbs: 0,
    impacto_diferenca_creditos: 0,
    fundamento: 'Leis 10.637/2002 e 10.833/2003, art. 3º; LC 214/2025, arts. 4º, 47 e 49.',
    reclassificar_quando_servico_identificado: true,
  };
}

// Arts. 237/238 da LC 214 e art. 337 do Decreto 12.955/2026: o crédito do
// adquirente de plano de saúde não nasce da alíquota CBS geral da fatura. Ele
// é limitado ao débito da operadora e depende da condição trabalhista. Quando
// esse débito não foi informado, mantemos uma estimativa parametrizada apenas
// para projeção, sem lançá-la na apuração como crédito habilitado.
function memoriaPlanoAssistenciaSaude(item, cls, aliq, rec) {
  if (!ehPlanoAssistenciaSaude(item, cls)) return null;
  const plano = item.planoSaude && typeof item.planoSaude === 'object' ? item.planoSaude : {};
  const percentualEmpresaInformado = plano.participacao_empresa ?? item.participacao_financeira_empresa;
  const percentualEmpregadosInformado = plano.participacao_empregados ?? item.participacao_financeira_empregados;
  const coparticipacaoInformada = plano.coparticipacao_empregados ?? item.coparticipacao_empregados;
  const participacaoEmpresa = percentualEmpresaInformado === null || percentualEmpresaInformado === undefined || percentualEmpresaInformado === ''
    ? 1 : Math.max(0, Math.min(1, num(percentualEmpresaInformado)));
  const participacaoEmpregados = percentualEmpregadosInformado === null || percentualEmpregadosInformado === undefined || percentualEmpregadosInformado === ''
    ? 0 : Math.max(0, Math.min(1, num(percentualEmpregadosInformado)));
  const coparticipacao = coparticipacaoInformada === null || coparticipacaoInformada === undefined || coparticipacaoInformada === '' ? 0 : Math.max(0, num(coparticipacaoInformada));
  const debitoInformado = plano.debito_cbs_operadora ?? item.debito_cbs_operadora;
  const temDebitoOperadora = debitoInformado !== null && debitoInformado !== undefined && debitoInformado !== '' && Number.isFinite(Number(debitoInformado));
  const fatorEstimativa = Math.max(0, Math.min(1, num(regras.padrao('fator_cbs_estimado_planos_saude', 0.4))));
  const baseFinanceira = Math.max(0, num(item.valor) || num(rec.precoAtual));
  const aliquotaEstimada = num(aliq.aliquotaReferencia?.cbs) * fatorEstimativa;
  const debitoOperadora = temDebitoOperadora ? Math.max(0, num(debitoInformado)) : baseFinanceira * aliquotaEstimada;
  return {
    rotulo: 'Crédito CBS estimado — regime específico de planos de saúde',
    base_financeira: r2(baseFinanceira),
    participacao_empresa: participacaoEmpresa,
    participacao_empregados: participacaoEmpregados,
    coparticipacao_empregados: r2(coparticipacao),
    debito_cbs_operadora: r2(debitoOperadora),
    debito_operadora_informado: temDebitoOperadora,
    aliquota_estimada: temDebitoOperadora ? null : r6(aliquotaEstimada),
    fator_estimativa_regime_especifico: temDebitoOperadora ? null : r6(fatorEstimativa),
    credito_cbs_estimado: r2(debitoOperadora * participacaoEmpresa),
    elegibilidade_legal: plano.elegibilidade_legal_confirmada === true ? 'CONFIRMADA' : 'Elegibilidade legal presumida exclusivamente para fins de projeção.',
    aviso: 'Projeção realizada com participação financeira integral da empresa e elegibilidade legal hipotética. Crédito sujeito à confirmação dos requisitos legais e dos dados da operadora.',
  };
}
function cargaValeAlimentacao(item = {}) {
  const texto = String(item.descricao || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return somenteDigitos(item.nbs) === '109014000'
    && /\b(CARGA|REPASSE)\b/.test(texto)
    && /\b(CARTAO|VALE)\b/.test(texto)
    && /\b(ALIMENTACAO|REFEICAO)\b/.test(texto);
}

// LC 214/2025, arts. 276 e 283: a vedação é do adquirente. Ela não impede
// que o próprio hotel/parque aproveite créditos das suas aquisições (art. 282).
// A alimentação contratada por PJ ficou deliberadamente fora do bloqueio: ela
// não integra o regime específico de bares e restaurantes (art. 273, §2º).
function vedacaoCreditoAdquirenteRegimeEspecifico(item = {}, cls = {}) {
  const cclasstrib = somenteDigitos(cls.cclasstrib);
  const cst = somenteDigitos(cls.cst);
  const lc116 = somenteDigitos(item.lc116);
  const nbs = somenteDigitos(item.nbs);
  if (cst.startsWith('4') || ['zero', 'imune'].includes(String(cls.reducao || '').toLowerCase())) {
    return { status: 'SEM_DIREITO', modalidade: 'OPERACAO_SEM_CREDITO_ADQUIRENTE',
      motivo: 'Operação imune, isenta ou com alíquota zero: não permite apropriação de crédito pelo adquirente (LC 214/2025, art. 49).' };
  }
  if (cclasstrib === '200048' || (lc116 === '0901' && /^1030[34]/.test(nbs))) {
    return { status: 'SEM_DIREITO', modalidade: 'REGIME_ESPECIFICO_SEM_CREDITO_ADQUIRENTE',
      motivo: 'Serviços de hotelaria, parques de diversão ou parques temáticos: o adquirente não pode apropriar crédito de CBS/IBS (LC 214/2025, art. 283).' };
  }
  if (nbs === '103011000' && item.fornecimento_alimentacao_contrato_pj !== true) {
    return { status: 'SEM_DIREITO', modalidade: 'REGIME_ESPECIFICO_SEM_CREDITO_ADQUIRENTE',
      motivo: 'Alimentação fornecida por bar ou restaurante: o adquirente não pode apropriar crédito de CBS/IBS (LC 214/2025, art. 276).' };
  }
  if (cclasstrib === '200021') {
    return { status: 'SEM_DIREITO', modalidade: 'REGIME_ESPECIFICO_SEM_CREDITO_ADQUIRENTE',
      motivo: 'Serviço de transporte coletivo de passageiros no regime específico: o adquirente não pode apropriar crédito de CBS/IBS (LC 214/2025, art. 285, III).' };
  }
  if (cclasstrib === '010002' && cargaValeAlimentacao(item)) {
    return { status: 'DADOS_INSUFICIENTES', statusDeterminacao: 'INDETERMINADO', modalidade: 'VALE_ALIMENTACAO_ARRANJO_PAGAMENTO',
      motivo: 'Carga de vale-alimentação identificada. A classificação está concluída; o crédito CBS será limitado ao débito apurado e extinto pelo fornecedor ou participante do arranjo.' };
  }
  if (cclasstrib === '010002' && item.credito_servico_financeiro_permitido !== true) {
    return { status: 'SUJEITO_VALIDACAO', modalidade: 'SERVICO_FINANCEIRO_CREDITO_CONDICIONAL',
      motivo: 'Serviço financeiro: crédito somente é admitido nas hipóteses expressas da LC 214/2025, arts. 194 a 198. A operação não traz a evidência dessa hipótese.' };
  }
  return null;
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
      lc116: item.lc116 || (String(item.modelo_documento_fiscal || '').toLowerCase() === 'nfse' ? bases.normLc116(item.cst) : ''),
      equivalencia_classificatoria: equivalencia,
    },
    decisao,
    equivalente: true,
    equivalencia,
  };
}

function avaliarCredito({ regimeAdquirente, regimeFornecedor, cls, sentido, item = {}, simplesFornecedorConhecido = false, simplesFornecedorReferencia = null, decisaoClassificatoria = null }) {
  if (sentido === 'entrada' && cls?.semCreditoPorCfop) {
    return credito('SEM_DIREITO', 'SEM_CREDITO', 'CFOP_SEM_AQUISICAO', 'DETERMINADO', 'CFOP de remessa para conserto/reparo: não caracteriza aquisição e não gera crédito de entrada.');
  }
  if (sentido === 'entrada') {
    const vedacaoRegimeEspecifico = vedacaoCreditoAdquirenteRegimeEspecifico(item, cls);
    if (vedacaoRegimeEspecifico) return credito(vedacaoRegimeEspecifico.status, vedacaoRegimeEspecifico.status === 'SEM_DIREITO' ? 'SEM_CREDITO' : null,
      vedacaoRegimeEspecifico.modalidade, vedacaoRegimeEspecifico.statusDeterminacao || (vedacaoRegimeEspecifico.status === 'SEM_DIREITO' ? 'DETERMINADO' : 'SUJEITO_VALIDACAO'), vedacaoRegimeEspecifico.motivo);
  }
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
  // A opção híbrida altera apenas a posição da empresa analisada: nas saídas
  // ela passa a apurar IBS/CBS por fora; nas entradas, passa a apropriar o
  // crédito como adquirente regular. O regime do fornecedor não é alterado.
  const empresaHibrida = ctx.hibrido === true && ['simples_nacional', 'mei'].includes(ctx.empresa?.regime);
  const regimeEmitenteProjetado = empresaHibrida && sentido === 'saida' ? 'simples_regime_regular' : regimeEmitente;
  const regimeAdquirenteProjetado = empresaHibrida && sentido === 'entrada' ? 'simples_regime_regular' : regimeAdquirente;

  // ---------- 1. CLASSIFICAÇÃO (sempre antes do cálculo) ----------
  // A execução oficial não fornece classificação prévia. O campo opcional é
  // exclusivo da comparação em sombra e permite provar que o reuso em memória
  // produz o mesmo resultado antes de qualquer otimização persistente.
  let cls = ctx.classificacaoPrecalculada
    ? structuredClone(ctx.classificacaoPrecalculada)
    : classificar(item, { empresa: ctx.empresa, sentido, regimeContraparte: ctx.regimeContraparte,
      perfilDestinatario: ctx.perfilDestinatario, elegibilidadeAnexoXi: ctx.elegibilidadeAnexoXi });
  const contribuicaoAssociativa = sentido === 'entrada' ? memoriaContribuicaoAssociativa(item) : null;
  const honorarioAdvocaticio = sentido === 'entrada' ? memoriaHonorarioAdvocaticio(item) : null;
  const custaTaxaJudicial = sentido === 'entrada' ? memoriaCustaTaxaOuDepositoJudicial(item) : null;
  if (contribuicaoAssociativa) {
    // Sem documento fiscal ou serviço individualizado, não existe base para
    // declarar uma operação tributada. A classificação fica explicitamente
    // pendente, sem inventar CST/cClassTrib para a contribuição associativa.
    cls = { ...cls, cst: '', cclasstrib: '', status: 'CLASSIFICACAO_FISCAL_PENDENTE', reducao: null, reducaoIbs: 0, reducaoCbs: 0,
      origemRegra: 'CONTRIBUICAO_ASSOCIATIVA_PRESUMIDA',
      tratamento: contribuicaoAssociativa.status };
  }
  if (honorarioAdvocaticio) {
    // A escolha explícita da natureza específica é a evidência classificatória
    // da simulação. Não se aplica à natureza contábil genérica de legais e
    // judiciais, que continua pendente para as demais operações.
    cls = { ...cls, cst: honorarioAdvocaticio.cst, cclasstrib: honorarioAdvocaticio.cclasstrib,
      status: 'CLASSIFICADO', reducao: 'reduzida', reducaoIbs: honorarioAdvocaticio.reducao_aliquota,
      reducaoCbs: honorarioAdvocaticio.reducao_aliquota, origemRegra: 'HONORARIOS_ADVOCATICIOS_ART_127',
      tratamento: honorarioAdvocaticio.rotulo, fundamento: honorarioAdvocaticio.fundamento };
  }
  if (custaTaxaJudicial) {
    cls = { ...cls, cst: '', cclasstrib: '', status: 'CLASSIFICACAO_FISCAL_PENDENTE', reducao: null, reducaoIbs: 0, reducaoCbs: 0,
      origemRegra: 'CUSTA_TAXA_DEPOSITO_JUDICIAL', tratamento: custaTaxaJudicial.status };
  }
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
  let rec = reconstruir({ ...contextoClassificatorio.item, tipo, regime: regimeEmitente, simples: simplesInfo,
    regra_geral_regime_confirmada: regraGeralRegimeConfirmada }, {
    ibsHabilitado: Number(aliq.parametros.calcular_ibs) === 1,
  });
  const planoAssistenciaSaude = memoriaPlanoAssistenciaSaude(contextoClassificatorio.item, cls, aliq, rec);
  if (honorarioAdvocaticio || custaTaxaJudicial) {
    // A alíquota/carga do prestador não demonstra crédito histórico do
    // adquirente. Sem hipótese validada, não retirar 3,65% ou 9,25% da
    // despesa nem formar a base CBS a partir dessa presunção.
    rec = {
      ...rec,
      baseEconomica: r2(num(item.valor) || rec.baseEconomica),
      memoriaPisCofins: {
        ...(rec.memoriaPisCofins || {}),
        carga_atual_pis_cofins_valor: 0,
        carga_atual_pis_cofins_origem: 'REGRA_ESPECIFICA_HONORARIOS_ADVOCATICIOS',
        base_reconstrucao_metodo: honorarioAdvocaticio
          ? 'Valor integral da despesa; crédito histórico de PIS/Cofins não presumido para honorários advocatícios.'
          : 'Valor integral da despesa; taxa, custa ou depósito judicial não possui crédito histórico presumido.',
      },
    };
  }
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
  const regEmit = regras.regime(regimeEmitenteProjetado);
  const emitenteNoDas = !!(regEmit && regEmit.noDas);
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
  if (planoAssistenciaSaude) {
    // A base da projeção é a fatura suportada pela empresa, não a base
    // reconstruída por PIS/Cofins. A CBS segue o débito efetivo da operadora
    // ou a estimativa específica configurada, jamais a CBS geral da fatura.
    ibs = 0;
    cbs = planoAssistenciaSaude.debito_cbs_operadora;
    natureza = planoAssistenciaSaude.debito_operadora_informado ? 'CALCULADO' : 'SIMULADO';
    aliq.trilha.push({ etapa: 'regime específico — planos de assistência à saúde',
      baseFinanceira: planoAssistenciaSaude.base_financeira,
      debitoOperadoraInformado: planoAssistenciaSaude.debito_operadora_informado,
      aliquotaEstimada: planoAssistenciaSaude.aliquota_estimada,
      cbs: r6(cbs), origem: planoAssistenciaSaude.rotulo });
  }
  if (contribuicaoAssociativa) {
    ibs = 0; cbs = 0; natureza = 'SEM_OPERACAO_TRIBUTADA_IDENTIFICADA';
    aliq.trilha.push({ etapa: 'contribuição associativa presumida', ibs: 0, cbs: 0,
      origem: contribuicaoAssociativa.premissa });
  }
  if (custaTaxaJudicial) {
    ibs = 0; cbs = 0; natureza = 'SEM_OPERACAO_TRIBUTADA_IDENTIFICADA';
    aliq.trilha.push({ etapa: 'taxa, custa ou depósito judicial', ibs: 0, cbs: 0, origem: custaTaxaJudicial.premissa });
  }
  // Fase CBS: mesmo no Simples, a parcela de IBS não integra a simulação até
  // ser habilitada expressamente na parametrização do ano.
  if (Number(aliq.parametros.calcular_ibs) !== 1) ibs = 0;

  // ---------- 5. CRÉDITO ----------
  const percentualEfetivoSimples = !!(simplesInfo && simplesInfo.aliquotaEfetiva);
  let cred = sentido === 'entrada' && item.entradaManual?.geraCredito === false
    ? credito('SEM_DIREITO', 'SEM_CREDITO', null, 'DETERMINADO', 'Cadastro do item de entrada: não gera crédito CBS/IBS nesta projeção.')
    : avaliarCredito({
      regimeAdquirente: regimeAdquirenteProjetado, regimeFornecedor: regimeEmitente, cls, sentido,
      item,
      decisaoClassificatoria: contextoClassificatorio.decisao,
      simplesFornecedorConhecido: percentualEfetivoSimples,
      // O status de crédito deve registrar DETERMINADO quando a operação traz o
      // percentual efetivo. A premissa só é enviada quando foi realmente usada.
      simplesFornecedorReferencia: percentualEfetivoSimples ? null : referenciaCreditoSimples,
    });
  if (planoAssistenciaSaude && sentido === 'entrada') {
    cred = credito('PROJECAO_ESTIMADA', 'PROJECAO_ESTIMADA_NAO_HABILITADA', 'REGIME_ESPECIFICO_PLANOS_SAUDE', 'DETERMINADO_POR_PREMISSA', planoAssistenciaSaude.aviso);
    cred.elegibilidadeLegal = {
      status: planoAssistenciaSaude.elegibilidade_legal.startsWith('CONFIRMADA') ? 'CONFIRMADA' : 'HIPOTESE_PROJECAO',
      fundamento: 'LC 214/2025, art. 57, §3º, IV, f; arts. 237 e 238; Decreto 12.955/2026, art. 337.',
      rotulo: planoAssistenciaSaude.elegibilidade_legal,
    };
    cred.projecaoPlanoSaude = planoAssistenciaSaude;
  }
  if (contribuicaoAssociativa) {
    cred = credito('PROJECAO_CONCLUIDA', 'SEM_CREDITO', 'CONTRIBUICAO_ASSOCIATIVA_PRESUMIDA', 'DETERMINADO_POR_PREMISSA', contribuicaoAssociativa.status);
    cred.projecaoContribuicaoAssociativa = contribuicaoAssociativa;
  }
  if (custaTaxaJudicial) {
    cred = credito('PROJECAO_CONCLUIDA', 'SEM_CREDITO', 'CUSTA_TAXA_DEPOSITO_JUDICIAL', 'DETERMINADO_POR_EVIDENCIA', custaTaxaJudicial.status);
    cred.projecaoCustaTaxaJudicial = custaTaxaJudicial;
  }
  if (honorarioAdvocaticio && sentido === 'entrada') {
    cred.elegibilidadeLegal = {
      status: 'HIPOTESE_PROJECAO',
      fundamento: honorarioAdvocaticio.fundamento,
      rotulo: 'Elegibilidade do art. 127 presumida exclusivamente para fins de projeção; a apropriação fiscal exige confirmação dos requisitos legais e documentais.',
    };
    cred.projecaoHonorarioAdvocaticio = honorarioAdvocaticio;
  }
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
  const elegibilidadeSimples = memoriaElegibilidadeSimples({ sentido, regimeEmitente, regimeAdquirente: regimeAdquirenteProjetado, cls, item, ano });
  if (elegibilidadeSimples) {
    cred.elegibilidadeLegal = elegibilidadeSimples;
    cred.percentualCreditoOrigem = percentualEfetivoSimples ? 'DOCUMENTO_OU_FAIXA_EFETIVA'
      : referenciaCreditoSimples > 0 ? 'PARAMETRO_CREDITO_SIMPLES' : 'PERCENTUAL_NAO_DETERMINADO';
    cred.origem = cred.percentualCreditoOrigem;
    cred.natureza = percentualEfetivoSimples ? 'CALCULADO'
      : referenciaCreditoSimples > 0 ? 'SIMULADO' : 'INDETERMINADO';
  }
  let creditoIbs = 0, creditoCbs = 0, creditoCbsEstimado = 0;
  if (['PROJETADO', 'PROJETADO_LIMITADO'].includes(cred.status)) { creditoIbs = ibs; creditoCbs = cbs; }
  if (planoAssistenciaSaude && sentido === 'entrada') creditoCbsEstimado = planoAssistenciaSaude.credito_cbs_estimado;
  let creditoPisCofinsAdquirente = sentido === 'entrada'
    ? resolverCreditoPisCofinsAdquirente({
      regimeAdquirente,
      regraEspecificaCredito: item.regra_credito_pis_cofins || null,
      referenciaFiscal: item.referencia_credito_pis_cofins || null,
    })
    : null;
  if (planoAssistenciaSaude && sentido === 'entrada') {
    creditoPisCofinsAdquirente = {
      valor: 0, status: 'DETERMINADO', classificacao: 'CREDITO_HISTORICO_ZERO_PLANO_SAUDE',
      motivo: 'Plano privado de assistência à saúde: sem hipótese legal histórica específica validada, PIS/Cofins de entrada permanece R$ 0,00.',
      origem: 'REGRA_ESPECIFICA_PLANOS_SAUDE', natureza: 'CALCULADO', ausencia_regra_especifica_superior: false,
    };
  }
  if (contribuicaoAssociativa) {
    creditoPisCofinsAdquirente = {
      valor: 0, status: 'DETERMINADO', classificacao: 'CREDITO_HISTORICO_ZERO_CONTRIBUICAO_ASSOCIATIVA',
      motivo: 'Contribuição associativa presumida sem contraprestação individualizada: não há crédito histórico de PIS/Cofins.',
      origem: 'CONTRIBUICAO_ASSOCIATIVA_PRESUMIDA', natureza: 'CALCULADO', ausencia_regra_especifica_superior: false,
    };
  }
  if (custaTaxaJudicial) {
    creditoPisCofinsAdquirente = {
      valor: 0, status: 'DETERMINADO', classificacao: 'CREDITO_HISTORICO_ZERO_CUSTA_TAXA_DEPOSITO_JUDICIAL',
      motivo: 'Taxa, custa ou depósito judicial: não há crédito histórico presumido de PIS/Cofins.',
      origem: 'CUSTA_TAXA_DEPOSITO_JUDICIAL', natureza: 'CALCULADO', ausencia_regra_especifica_superior: false,
    };
  }
  if (honorarioAdvocaticio && sentido === 'entrada') {
    creditoPisCofinsAdquirente = {
      valor: 0, status: 'DETERMINADO', classificacao: 'CREDITO_HISTORICO_ZERO_HONORARIOS_ADVOCATICIOS',
      motivo: 'Honorários advocatícios: a tributação do prestador não comprova crédito de PIS/Cofins do contratante; não presumir 3,65% sem hipótese legal específica validada.',
      origem: 'REGRA_ESPECIFICA_HONORARIOS_ADVOCATICIOS', natureza: 'CALCULADO', ausencia_regra_especifica_superior: false,
    };
  }
  // CREDITO_PRESUMIDO fica em zero até que a hipótese seja informada como
  // premissa — o sistema sinaliza a possibilidade, não a arbitra.

  // Na opção híbrida, IBS/CBS passam a ser calculados pelo regime regular,
  // mas a parcela equivalente que já era recolhida dentro do DAS deixa de
  // compor esse recolhimento. Para medir impacto de faturamento, somamos a
  // carga regular e retiramos a parcela substituída — nunca as duas juntas.
  const reparticaoDas = simplesInfo?.reparticao || {};
  const hibridoEmSaida = empresaHibrida && sentido === 'saida';
  const cbsDoDasInformada = ctx.cbsDentroDoDas !== null && ctx.cbsDentroDoDas !== undefined;
  const cbsDentroDoDas = hibridoEmSaida && cbsDoDasInformada
    ? num(ctx.cbsDentroDoDas)
    : hibridoEmSaida && num(simplesInfo?.aliquotaEfetiva) > 0
      ? rec.baseEconomica * num(simplesInfo.aliquotaEfetiva) * (num(reparticaoDas.pis) + num(reparticaoDas.cofins))
      : 0;
  const ibsDentroDoDas = hibridoEmSaida && ibs > 0 && num(simplesInfo?.aliquotaEfetiva) > 0
    ? rec.baseEconomica * num(simplesInfo.aliquotaEfetiva) * num(reparticaoDas.icms_iss)
    : 0;
  // A comparação é apresentada em centavos; calcule o líquido a partir dos
  // mesmos valores arredondados exibidos para evitar diferença de R$ 0,01.
  const cbsDentroDoDasArredondada = r2(cbsDentroDoDas);
  const ibsDentroDoDasArredondada = r2(ibsDentroDoDas);
  const dasAtualInformado = ctx.dasAtualDaVenda !== null && ctx.dasAtualDaVenda !== undefined;
  const dasAtualDaVenda = hibridoEmSaida && dasAtualInformado
    ? num(ctx.dasAtualDaVenda)
    : hibridoEmSaida && num(simplesInfo?.aliquotaEfetiva) > 0
      ? rec.precoAtual * num(simplesInfo.aliquotaEfetiva)
      : 0;
  const tributosSubstituidosDoDas = cbsDentroDoDasArredondada + ibsDentroDoDasArredondada;
  const dasResidualHibrido = hibridoEmSaida ? Math.max(0, r2(dasAtualDaVenda) - tributosSubstituidosDoDas) : null;
  const impactoHibridoLiquido = hibridoEmSaida ? r2(r2(ibs) + r2(cbs) - tributosSubstituidosDoDas) : null;
  const precoProjetado = planoAssistenciaSaude && sentido === 'entrada'
    ? rec.precoAtual + cbs
    : hibridoEmSaida
    ? rec.precoAtual + impactoHibridoLiquido
    : emitenteNoDas
      ? rec.precoMercadoria                    // no DAS o preço não recebe IVA por fora
      : rec.baseEconomica + ibs + cbs;
  const custoLiquido = precoProjetado - creditoIbs - creditoCbs;
  const custoLiquidoComCreditoEstimado = precoProjetado - creditoIbs - creditoCbs - creditoCbsEstimado;

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
    creditoIbs: r2(creditoIbs), creditoCbs: r2(creditoCbs), creditoCbsEstimado: r2(creditoCbsEstimado), creditoTotal: r2(creditoIbs + creditoCbs),
    credito: cred,
    creditoPisCofinsAdquirente,
    projecaoPlanoSaude: planoAssistenciaSaude,
    projecaoContribuicaoAssociativa: contribuicaoAssociativa,
    projecaoHonorarioAdvocaticio: honorarioAdvocaticio,
    projecaoCustaTaxaJudicial: custaTaxaJudicial,
    regimeCbsEmitente: regimeCbs(regimeEmitenteProjetado), regimeCbsAdquirente: regimeCbs(regimeAdquirenteProjetado),
    precoProjetado: r2(precoProjetado),
    custoLiquido: r2(custoLiquido),
    custoLiquidoComCreditoEstimado: r2(custoLiquidoComCreditoEstimado),
    cbsDentroDoDas: cbsDentroDoDasArredondada,
    origemCbsDentroDoDas: hibridoEmSaida
      ? (cbsDoDasInformada ? (ctx.origemCbsDentroDoDas || 'PGDAS_IMPORTADO') : 'FAIXA_SIMPLES_ESTIMADA')
      : 'NAO_APLICAVEL',
    dasAtualDaVenda: hibridoEmSaida ? r2(dasAtualDaVenda) : null,
    dasResidualHibrido: dasResidualHibrido === null ? null : r2(dasResidualHibrido),
    ibsDentroDoDas: ibsDentroDoDasArredondada,
    tributosSubstituidosDoDas: r2(tributosSubstituidosDoDas),
    impactoHibridoLiquido: impactoHibridoLiquido === null ? null : r2(impactoHibridoLiquido),
    emitenteNoDas,
    projecaoRegime: empresaHibrida ? 'SIMPLES_HIBRIDO' : 'REGIME_ATUAL',
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
  anexosSimples, avaliarCredito, contextoAposEquivalencia, vedacaoCreditoAdquirenteRegimeEspecifico,
};

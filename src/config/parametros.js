/**
 * PARÂMETROS DA REFORMA TRIBUTÁRIA (EC 132/2023 + LC 214/2025)
 * ---------------------------------------------------------------------------
 * Todo o motor de cálculo lê deste arquivo. Alterando aqui, muda o sistema
 * inteiro (calculadora, cenários, precificação e relatórios).
 *
 * As alíquotas de referência (CBS 8,80% / IBS 17,70%) são estimativas oficiais
 * do Ministério da Fazenda e SERÃO revisadas por lei ordinária/resolução do
 * Senado. Mantenha este arquivo atualizado — é o único ponto de manutenção.
 */

// --------------------------------------------------------------------------
// 1. ALÍQUOTAS DE REFERÊNCIA DO IVA DUAL
// --------------------------------------------------------------------------
const ALIQUOTA_REFERENCIA = {
  cbs: 0.088,   // Contribuição sobre Bens e Serviços (União) - substitui PIS/COFINS
  ibs: 0.177,   // Imposto sobre Bens e Serviços (Estados/Municípios) - substitui ICMS/ISS
};

// --------------------------------------------------------------------------
// 2. CRONOGRAMA DE TRANSIÇÃO (2026 -> 2033)
// --------------------------------------------------------------------------
// cbs / ibs .......... alíquotas nominais aplicadas no ano
// fatorIcmsIss ....... percentual do ICMS/ISS ainda devido (1 = integral)
// fatorPisCofins ..... percentual do PIS/COFINS ainda devido
// fatorIpi ........... percentual do IPI ainda devido (ZFM tem regra própria)
// compensavel ........ o recolhido de CBS/IBS é compensado com PIS/COFINS (2026)
const CRONOGRAMA = {
  2026: { cbs: 0.009, ibs: 0.001, fatorIcmsIss: 1.0, fatorPisCofins: 1.0, fatorIpi: 1.0, compensavel: true,
          nota: 'Ano-teste. O 1% (0,9% CBS + 0,1% IBS) é compensável com PIS/COFINS devido — sem aumento de carga, mas exige adequação de sistema e leiaute fiscal.' },
  2027: { cbs: 0.087, ibs: 0.001, fatorIcmsIss: 1.0, fatorPisCofins: 0.0, fatorIpi: 0.0, compensavel: false,
          nota: 'PIS/COFINS extintos. CBS cheia (referência reduzida em 0,1 p.p.). IPI zerado, exceto produtos com similar na ZFM. Início do Imposto Seletivo.' },
  2028: { cbs: 0.087, ibs: 0.001, fatorIcmsIss: 1.0, fatorPisCofins: 0.0, fatorIpi: 0.0, compensavel: false,
          nota: 'Mesma estrutura de 2027.' },
  2029: { cbs: 0.088, ibs: 0.0177, fatorIcmsIss: 0.9, fatorPisCofins: 0.0, fatorIpi: 0.0, compensavel: false,
          nota: 'Início da transição estadual/municipal: IBS a 1/10 e ICMS/ISS a 90%. Benefícios fiscais de ICMS reduzidos na mesma proporção.' },
  2030: { cbs: 0.088, ibs: 0.0354, fatorIcmsIss: 0.8, fatorPisCofins: 0.0, fatorIpi: 0.0, compensavel: false, nota: 'IBS a 2/10 e ICMS/ISS a 80%.' },
  2031: { cbs: 0.088, ibs: 0.0531, fatorIcmsIss: 0.7, fatorPisCofins: 0.0, fatorIpi: 0.0, compensavel: false, nota: 'IBS a 3/10 e ICMS/ISS a 70%.' },
  2032: { cbs: 0.088, ibs: 0.0708, fatorIcmsIss: 0.6, fatorPisCofins: 0.0, fatorIpi: 0.0, compensavel: false, nota: 'IBS a 4/10 e ICMS/ISS a 60%.' },
  2033: { cbs: 0.088, ibs: 0.177,  fatorIcmsIss: 0.0, fatorPisCofins: 0.0, fatorIpi: 0.0, compensavel: false,
          nota: 'Sistema definitivo: ICMS e ISS extintos. Apenas IBS + CBS (IVA Dual ~26,5%).' },
};

const ANOS = Object.keys(CRONOGRAMA).map(Number).sort();

// --------------------------------------------------------------------------
// 3. REGIMES TRIBUTÁRIOS
// --------------------------------------------------------------------------
// creditaAtual ........ o COMPRADOR deste regime aproveita créditos hoje?
// geraCreditoAtual .... o FORNECEDOR deste regime gera crédito hoje ao comprador?
// creditaNovo ......... aproveita CBS/IBS como crédito no novo modelo?
// geraCreditoNovo ..... destaca CBS/IBS cheio na nota (gera crédito integral)?
const REGIMES = {
  lucro_real: {
    label: 'Lucro Real',
    pisCofins: 9.25, cumulativo: false,
    creditaAtual: { pisCofins: true, icms: true, ipi: true, iss: false },
    geraCreditoAtual: { pisCofins: true, icms: true, ipi: true },
    creditaNovo: true, geraCreditoNovo: true,
    obs: 'Não cumulativo. Hoje já credita PIS/COFINS (9,25%) e ICMS. É o regime que menos sente a mudança na tomada de crédito.',
  },
  regime_regular: {
    label: 'Regime regular (não optante pelo Simples)',
    pisCofins: null, cumulativo: null,
    creditaAtual: { pisCofins: true, icms: true, ipi: true, iss: false },
    geraCreditoAtual: { pisCofins: true, icms: true, ipi: true },
    creditaNovo: true, geraCreditoNovo: true,
    obs: 'Para IBS/CBS o que importa é estar fora do Simples: o contribuinte apura pelo regime regular, credita as entradas e destaca integralmente nas saídas. A distinção entre Lucro Real e Presumido só afeta a reconstrução do PIS/COFINS atual, não o crédito futuro. É o enquadramento que o XML permite afirmar com segurança quando o emitente declara não ser optante.',
  },
  lucro_presumido: {
    label: 'Lucro Presumido',
    pisCofins: 3.65, cumulativo: true,
    creditaAtual: { pisCofins: false, icms: true, ipi: true, iss: false },
    geraCreditoAtual: { pisCofins: false, icms: true, ipi: true },
    creditaNovo: true, geraCreditoNovo: true,
    obs: 'Cumulativo hoje (3,65% sem crédito). Passa a creditar 100% do IBS/CBS — grande ganho na entrada, mas alíquota de saída sobe fortemente em serviços.',
  },
  simples_nacional: {
    label: 'Simples Nacional',
    // Premissa econômica de reconstrução. Não é alíquota legal fixa do DAS.
    pisCofins: 2.5, cumulativo: true,
    creditaAtual: { pisCofins: false, icms: false, ipi: false, iss: false },
    geraCreditoAtual: { pisCofins: false, icms: false, ipi: false },
    creditaNovo: false, geraCreditoNovo: false,
    obs: 'Permanece no DAS. Para reconstrução econômica sem repartição efetiva disponível, usa a premissa versionada de 2,5% para PIS/COFINS. NÃO se apropria de créditos e transfere ao adquirente apenas o valor de IBS/CBS embutido no DAS. Pode OPTAR pelo regime regular do IBS/CBS (apurando por fora) — decisão central do diagnóstico.',
  },
  simples_regime_regular: {
    label: 'Simples Nacional (optante pelo regime regular de IBS/CBS)',
    pisCofins: 0, cumulativo: false,
    creditaAtual: { pisCofins: false, icms: false, ipi: false, iss: false },
    geraCreditoAtual: { pisCofins: false, icms: false, ipi: false },
    creditaNovo: true, geraCreditoNovo: true,
    obs: 'Recolhe IRPJ/CSLL/CPP pelo DAS e apura IBS/CBS por fora, no regime regular: credita nas compras e destaca integralmente nas vendas.',
  },
  mei: {
    label: 'MEI',
    pisCofins: 0, cumulativo: true,
    creditaAtual: { pisCofins: false, icms: false, ipi: false, iss: false },
    geraCreditoAtual: { pisCofins: false, icms: false, ipi: false },
    creditaNovo: false, geraCreditoNovo: false,
    obs: 'Não gera crédito ao adquirente. Cadeias com forte participação de MEI perdem competitividade no novo modelo.',
  },
  produtor_rural_pf: {
    label: 'Produtor Rural PF / não contribuinte',
    pisCofins: 0, cumulativo: true,
    creditaAtual: { pisCofins: false, icms: false, ipi: false, iss: false },
    geraCreditoAtual: { pisCofins: false, icms: false, ipi: false },
    creditaNovo: false, geraCreditoNovo: false,
    obs: 'Abaixo do limite de receita fica fora do regime regular; adquirente pode ter direito a crédito presumido (regra específica do agro).',
  },
  imune_isento: {
    label: 'Imune / Isento',
    pisCofins: 0, cumulativo: true,
    creditaAtual: { pisCofins: false, icms: false, ipi: false, iss: false },
    geraCreditoAtual: { pisCofins: false, icms: false, ipi: false },
    creditaNovo: false, geraCreditoNovo: false,
    obs: 'Entidades imunes/isentas: sem destaque e sem crédito na saída.',
  },
  pessoa_fisica: {
    label: 'Pessoa Física (consumidor final)',
    pisCofins: 0, cumulativo: true,
    creditaAtual: { pisCofins: false, icms: false, ipi: false, iss: false },
    geraCreditoAtual: { pisCofins: false, icms: false, ipi: false },
    creditaNovo: false, geraCreditoNovo: false,
    obs: 'Não credita. Sente o preço cheio — é o perfil de cliente mais sensível a repasse de IVA em serviços.',
  },
  orgao_publico: {
    label: 'Órgão Público',
    pisCofins: 0, cumulativo: true,
    creditaAtual: { pisCofins: false, icms: false, ipi: false, iss: false },
    geraCreditoAtual: { pisCofins: false, icms: false, ipi: false },
    creditaNovo: false, geraCreditoNovo: false,
    obs: 'Não credita. Aquisições públicas têm redução de alíquota com destinação integral do produto da arrecadação ao ente contratante, e contratos vigentes exigem reequilíbrio econômico-financeiro.',
  },
  exterior: {
    label: 'Exterior (exportação/importação)',
    pisCofins: 0, cumulativo: false,
    creditaAtual: { pisCofins: false, icms: false, ipi: false, iss: false },
    geraCreditoAtual: { pisCofins: false, icms: false, ipi: false },
    creditaNovo: true, geraCreditoNovo: false,
    obs: 'Exportação é imune com manutenção integral dos créditos. Importação é tributada para equalizar com o produto nacional.',
  },
};

// --------------------------------------------------------------------------
// 4. REGIMES DIFERENCIADOS / REDUÇÕES DE ALÍQUOTA
// --------------------------------------------------------------------------
const REDUCOES = {
  integral:        { label: 'Tributação integral', reducao: 0.00,
                     desc: 'Alíquota cheia do IBS/CBS.' },
  reducao_30:      { label: 'Redução de 30% — profissões liberais regulamentadas', reducao: 0.30,
                     desc: 'Advocacia, contabilidade, engenharia, medicina, arquitetura e demais profissões intelectuais de natureza regulamentada.' },
  reducao_60:      { label: 'Redução de 60%', reducao: 0.60,
                     desc: 'Saúde, educação, dispositivos médicos e de acessibilidade, medicamentos, alimentos para consumo humano, insumos agropecuários, produções artísticas e culturais, transporte coletivo, entre outros.' },
  reducao_100:     { label: 'Alíquota zero / Cesta Básica Nacional', reducao: 1.00,
                     desc: 'Cesta Básica Nacional de Alimentos, dispositivos e medicamentos específicos, hortifrúti, ovos e demais hipóteses de alíquota zero.' },
  imune:           { label: 'Imune (exportação, livros, ...)', reducao: 1.00,
                     desc: 'Exportações (com manutenção de crédito), livros, jornais e periódicos.' },
  especifico:      { label: 'Regime específico (combustíveis, financeiro, imobiliário, ...)', reducao: 0.00, especifico: true,
                     desc: 'Alíquota/ base próprias definidas em lei (monofasia de combustíveis, serviços financeiros, planos de saúde, bares e restaurantes, hotelaria, bens imóveis, transporte, sociedades cooperativas). Informe a alíquota efetiva manualmente.' },
};

// --------------------------------------------------------------------------
// 5. PADRÕES POR TIPO DE OPERAÇÃO (usado quando a nota não traz o imposto)
// --------------------------------------------------------------------------
const PADROES = {
  icmsInterno: 0.18,      // alíquota interna média — parametrizável por UF
  icmsInterestadual: 0.12,
  iss: 0.03,
  ipi: 0.00,
  simplesEfetivo: 0.08,   // alíquota efetiva média do DAS (usada só como estimativa)
  // parcela de IBS/CBS embutida no DAS que o adquirente pode aproveitar
  // (aproximação: parcela de ICMS+ISS+PIS+COFINS dentro da alíquota efetiva)
  simplesParcelaCreditavel: 0.35,
};

// --------------------------------------------------------------------------
// 6. IMPOSTO SELETIVO — setores sujeitos
// --------------------------------------------------------------------------
const IMPOSTO_SELETIVO = {
  ativo: true,
  desde: 2027,
  setores: ['Cigarros e produtos do tabaco', 'Bebidas alcoólicas', 'Bebidas açucaradas', 'Veículos',
            'Embarcações e aeronaves', 'Bens minerais extraídos', 'Concursos de prognósticos'],
  aliquotaPadrao: 0.00, // informar por produto quando aplicável
};

// --------------------------------------------------------------------------
// 7. CLASSIFICAÇÃO TRIBUTÁRIA (cClassTrib) — tabela reduzida e parametrizável
// --------------------------------------------------------------------------
// ATENÇÃO: manter sincronizada com a tabela oficial vigente (Nota Técnica do
// leiaute da NF-e/NFS-e). Estes são apenas os agrupamentos mais usados.
const CLASSIFICACAO_TRIBUTARIA = [
  { cst: '000', grupo: 'Tributação integral', reducao: 'integral' },
  { cst: '200', grupo: 'Alíquota reduzida', reducao: 'reducao_60' },
  { cst: '210', grupo: 'Redução para profissões regulamentadas', reducao: 'reducao_30' },
  { cst: '400', grupo: 'Isenção', reducao: 'reducao_100' },
  { cst: '410', grupo: 'Imunidade / não incidência', reducao: 'imune' },
  { cst: '510', grupo: 'Diferimento', reducao: 'integral' },
  { cst: '550', grupo: 'Suspensão', reducao: 'integral' },
  { cst: '620', grupo: 'Tributação monofásica', reducao: 'especifico' },
  { cst: '800', grupo: 'Regime específico', reducao: 'especifico' },
];

module.exports = {
  ALIQUOTA_REFERENCIA, CRONOGRAMA, ANOS, REGIMES, REDUCOES, PADROES,
  IMPOSTO_SELETIVO, CLASSIFICACAO_TRIBUTARIA,
};

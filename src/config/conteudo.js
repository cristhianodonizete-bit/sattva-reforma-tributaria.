/**
 * CONTEÚDO TÉCNICO DOS MÓDULOS 3 (CONTRATOS) E 4 (CAPACITAÇÃO)
 */

// ===========================================================================
// BIBLIOTECA DE CLÁUSULAS — Módulo Revisão de Contratos
// ===========================================================================
const CLAUSULAS = [
  {
    id: 'preco_liquido',
    titulo: 'Preço expresso sem tributos (preço líquido) + destaque do IBS/CBS',
    risco: 'alto',
    aplicacao: ['compra', 'fornecimento', 'venda', 'servico'],
    problema: 'Contratos que fixam preço "com todos os tributos inclusos" transferem ao fornecedor todo o risco da variação de alíquota durante a transição 2026-2033 — e ao comprador o risco inverso quando a alíquota cai.',
    texto: 'O preço ora ajustado corresponde ao valor líquido da contraprestação, não incluindo o Imposto sobre Bens e Serviços (IBS) e a Contribuição sobre Bens e Serviços (CBS), que serão acrescidos ao valor da nota fiscal e destacados em campo próprio, nas alíquotas vigentes na data do fato gerador, na forma da legislação aplicável.',
  },
  {
    id: 'reequilibrio',
    titulo: 'Reequilíbrio econômico-financeiro por alteração da legislação tributária',
    risco: 'alto',
    aplicacao: ['compra', 'fornecimento', 'venda', 'servico'],
    problema: 'Sem cláusula expressa, alterações de alíquota de referência (que serão revisadas por lei ao longo da transição) não geram direito automático a revisão de preço.',
    texto: 'Na hipótese de criação, extinção, majoração ou redução de tributos, alteração de alíquotas, de base de cálculo, de regime de apuração ou do direito a crédito que impacte, para mais ou para menos, o equilíbrio econômico-financeiro deste contrato, as partes procederão à revisão do preço, no prazo de 30 (trinta) dias contados da vigência da alteração, de modo a restabelecer a relação original entre encargos e retribuição pactuada.',
  },
  {
    id: 'repasse_credito',
    titulo: 'Garantia de destaque e transferência do crédito de IBS/CBS',
    risco: 'alto',
    aplicacao: ['compra', 'fornecimento'],
    problema: 'No novo modelo o crédito do adquirente depende do destaque correto e do efetivo recolhimento pelo fornecedor. Fornecedor inadimplente = crédito não aproveitado pelo comprador.',
    texto: 'O CONTRATADO obriga-se a emitir documento fiscal idôneo, com destaque integral e correto do IBS e da CBS, informando os códigos de classificação tributária exigidos pela legislação, de modo a assegurar ao CONTRATANTE a apropriação integral dos créditos correspondentes. O descumprimento sujeitará o CONTRATADO ao ressarcimento do crédito não aproveitado, acrescido dos encargos incidentes.',
  },
  {
    id: 'split_payment',
    titulo: 'Adequação ao split payment (recolhimento na liquidação financeira)',
    risco: 'alto',
    aplicacao: ['compra', 'fornecimento', 'venda', 'servico'],
    problema: 'Com o split payment, parte do valor pago é retida e destinada diretamente ao fisco. Isso altera o fluxo de caixa e a própria definição de "pagamento integral" prevista no contrato.',
    texto: 'As partes reconhecem que o pagamento poderá ser objeto de segregação no momento da liquidação financeira, com destinação direta ao fisco do montante correspondente ao IBS e à CBS. A retenção realizada nessa sistemática equivale, para todos os efeitos contratuais, ao pagamento da parcela correspondente, não caracterizando inadimplemento do CONTRATANTE nem gerando encargos moratórios.',
  },
  {
    id: 'regime_fornecedor',
    titulo: 'Informação e manutenção do regime tributário',
    risco: 'medio',
    aplicacao: ['compra', 'fornecimento'],
    problema: 'A alteração do regime do fornecedor (por exemplo, permanência no Simples sem opção pelo regime regular) muda o crédito do comprador sem qualquer aviso.',
    texto: 'O CONTRATADO declara o regime tributário sob o qual opera e obriga-se a comunicar ao CONTRATANTE, com antecedência mínima de 30 (trinta) dias, qualquer alteração de regime, inclusive a opção ou a renúncia ao regime regular do IBS e da CBS, facultado ao CONTRATANTE requerer a revisão do preço quando a alteração reduzir o crédito apropriável.',
  },
  {
    id: 'reajuste_indice',
    titulo: 'Índice de reajuste apartado da variação tributária',
    risco: 'medio',
    aplicacao: ['compra', 'fornecimento', 'venda', 'servico'],
    problema: 'Reajuste por índice de inflação não captura a mudança de carga tributária — o efeito se acumula silenciosamente na margem.',
    texto: 'O reajuste anual pelo índice ora pactuado incidirá exclusivamente sobre o preço líquido de tributos, sendo a variação da carga tributária tratada de forma autônoma na cláusula de reequilíbrio econômico-financeiro.',
  },
  {
    id: 'contratos_longa_duracao',
    titulo: 'Contratos de longa duração e regra de transição',
    risco: 'alto',
    aplicacao: ['fornecimento', 'venda', 'servico'],
    problema: 'Contratos firmados antes da vigência plena e com execução após 2026/2027 atravessam mais de um regime tributário durante a própria vigência.',
    texto: 'As partes reconhecem que a execução deste contrato se estenderá por períodos submetidos a regimes tributários distintos, conforme o cronograma de transição constitucional. Para cada evento de faturamento aplicar-se-á a legislação vigente na data do respectivo fato gerador, procedendo-se ao ajuste do preço na forma da cláusula de reequilíbrio.',
  },
  {
    id: 'orgao_publico',
    titulo: 'Contratos administrativos — reequilíbrio obrigatório',
    risco: 'alto',
    aplicacao: ['venda', 'servico'],
    problema: 'Contratos com a Administração Pública têm regime próprio de reequilíbrio e prazos formais para pleito. Perder o prazo significa absorver a diferença.',
    texto: 'Havendo alteração da carga tributária incidente sobre o objeto contratado, decorrente da instituição do IBS e da CBS ou da extinção dos tributos por eles substituídos, será promovida a revisão do valor contratado, mediante requerimento instruído com demonstrativo analítico do impacto, nos termos da legislação de licitações e contratos administrativos.',
  },
  {
    id: 'responsabilidade_solidaria',
    titulo: 'Responsabilidade por classificação fiscal incorreta',
    risco: 'medio',
    aplicacao: ['compra', 'fornecimento'],
    problema: 'Erro de NCM/NBS/cClassTrib do fornecedor gera glosa de crédito e autuação no adquirente.',
    texto: 'O CONTRATADO responde pela correta classificação fiscal dos bens e serviços fornecidos, inclusive quanto ao NCM, à NBS e aos códigos de classificação tributária, respondendo por perdas e danos, glosas de crédito, multas e demais encargos suportados pelo CONTRATANTE em razão de classificação incorreta.',
  },
  {
    id: 'devolucoes',
    titulo: 'Devoluções, cancelamentos e ajustes de preço',
    risco: 'baixo',
    aplicacao: ['compra', 'fornecimento', 'venda'],
    problema: 'O novo modelo exige documento fiscal específico para estorno de crédito; contratos silentes geram divergência entre o financeiro e o fiscal.',
    texto: 'Nas hipóteses de devolução, cancelamento, desconto incondicional posterior ou qualquer ajuste do preço, as partes emitirão os documentos fiscais próprios para o correspondente estorno ou complemento de IBS e CBS, no mesmo período de apuração em que ocorrer o evento.',
  },
];

// ===========================================================================
// TRILHAS DE CAPACITAÇÃO — Módulo 4
// ===========================================================================
const TRILHAS = [
  {
    id: 'workshop_pratico',
    titulo: 'Workshop Prático — Compras, Suprimentos, Fiscal e Pricing',
    carga: 8, formato: 'presencial',
    publico: ['Compras', 'Suprimentos', 'Fiscal', 'Pricing', 'Comercial'],
    objetivo: 'Capacitar as equipes diretamente envolvidas na operação, com aplicação prática sobre os dados reais da empresa.',
    conteudo: [
      'Leitura do diagnóstico da própria empresa: onde estão os impactos',
      'Como avaliar um fornecedor pelo preço SEM imposto (e não pelo preço de nota)',
      'Crédito integral x crédito limitado: Simples, MEI e produtor rural na cadeia',
      'Estudo de caso: renegociação de preço com fornecedor do Simples',
      'Formação de preço com IVA por fora e recomposição de margem',
      'Régua de repasse por perfil de cliente (PJ que credita x PF x órgão público)',
      'Campos novos do documento fiscal: cClassTrib, NBS, destaque de IBS/CBS',
      'Split payment e efeito no fluxo de caixa',
      'Rotina de conferência: da nota ao crédito apropriado',
    ],
  },
  {
    id: 'workshop_boas_praticas',
    titulo: 'Workshop de Boas Práticas — Institucional',
    carga: 4, formato: 'presencial ou online',
    publico: ['Todos os colaboradores', 'Diretoria', 'Administrativo'],
    objetivo: 'Disseminar conhecimento e preparar toda a organização para o novo ambiente tributário.',
    conteudo: [
      'Por que o Brasil mudou o sistema de tributação sobre o consumo',
      'IVA Dual: o que é IBS, o que é CBS e o que cada um substitui',
      'Não cumulatividade plena: o crédito como regra',
      'Cronograma da transição: 2026, 2027, 2029-2032 e 2033',
      'Imposto Seletivo e cashback: conceitos gerais',
      'Impactos nas compras da empresa',
      'Impactos nas vendas e no relacionamento com o cliente',
      'O que muda no dia a dia de cada área',
    ],
  },
  {
    id: 'trilha_fiscal',
    titulo: 'Trilha Técnica — Equipe Fiscal e Contábil',
    carga: 12, formato: 'modular',
    publico: ['Fiscal', 'Contabilidade', 'TI Fiscal'],
    objetivo: 'Preparar a retaguarda fiscal para apuração, escrituração e conformidade documental no novo modelo.',
    conteudo: [
      'Base normativa: EC 132/2023 e LC 214/2025',
      'Fato gerador, base de cálculo e local da operação (princípio do destino)',
      'Apuração e compensação de créditos; créditos presumidos',
      'Regimes diferenciados e específicos: quando se aplicam de fato',
      'Novos leiautes: NF-e, NFS-e, NFC-e, NF-e ABI e CT-e',
      'cClassTrib, CST e NBS na prática',
      'Obrigações acessórias na convivência dos dois sistemas (2026-2032)',
      'Controles internos e trilha de auditoria do crédito',
    ],
  },
];

module.exports = { CLAUSULAS, TRILHAS };

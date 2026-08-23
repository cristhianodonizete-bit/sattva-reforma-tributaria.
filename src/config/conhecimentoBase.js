/**
 * SEMENTE DA BASE DE CONHECIMENTO
 * ---------------------------------------------------------------------------
 * Conteúdo técnico que alimenta o RAG na primeira execução. É a base mínima
 * para a IA analisar contratos com fundamento — a Sattva complementa subindo
 * seus próprios materiais (pareceres, minutas padrão, notas técnicas, atos
 * normativos) pela tela "Base de conhecimento".
 *
 * ATENÇÃO: revise e atualize conforme a regulamentação avança. Trechos aqui
 * são resumos técnicos de trabalho, não substituem o texto legal vigente.
 */
module.exports = [
{
  titulo: 'IVA Dual: estrutura do IBS e da CBS',
  fonte: 'EC 132/2023 e LC 214/2025 — síntese técnica Sattva',
  categoria: 'legislacao',
  conteudo: `A reforma da tributação sobre o consumo substitui cinco tributos por um IVA Dual. A CBS (Contribuição sobre Bens e Serviços), de competência da União, substitui PIS e COFINS. O IBS (Imposto sobre Bens e Serviços), de competência compartilhada entre Estados, Distrito Federal e Municípios, substitui ICMS e ISS. O IPI é reduzido a zero a partir de 2027, salvo para produtos com industrialização equivalente na Zona Franca de Manaus.

Características centrais:
- Incidência por fora: o IBS e a CBS não integram a própria base de cálculo nem a base um do outro, diferentemente do ICMS, do ISS e das contribuições atuais, que são calculados por dentro. A comparação entre alíquotas nominais do sistema atual e do novo é enganosa; a comparação válida é de carga efetiva sobre o preço líquido de tributos.
- Não cumulatividade plena: o crédito é a regra. Salvo hipóteses expressas de vedação (bens e serviços de uso e consumo pessoal), toda aquisição por contribuinte do regime regular gera crédito integral do imposto destacado.
- Princípio do destino: a arrecadação cabe ao ente do local de consumo, e não ao da produção.
- Base ampla: bens materiais e imateriais, direitos e serviços, incluindo operações antes fora do campo do ICMS e do ISS.
- Alíquotas de referência estimadas: CBS em torno de 8,8% e IBS em torno de 17,7%, totalizando aproximadamente 26,5%, sujeitas a revisão para preservar a carga total.
- Cada ente federativo pode fixar alíquota própria de IBS por lei específica; na ausência, aplica-se a de referência.` },

{
  titulo: 'Cronograma da transição 2026 a 2033',
  fonte: 'EC 132/2023 — síntese técnica Sattva',
  categoria: 'legislacao',
  conteudo: `2026 — ano-teste. CBS a 0,9% e IBS a 0,1%, totalizando 1%. O valor recolhido é compensável com o PIS e a COFINS devidos, de modo que não há aumento efetivo de carga; a exigência é operacional: emissão com os novos campos, apuração e teste do mecanismo de crédito. PIS e COFINS continuam plenamente vigentes.

2027 — extinção do PIS e da COFINS. A CBS passa a ser cobrada com alíquota cheia (referência reduzida em 0,1 ponto percentual em 2027 e 2028, período em que o IBS permanece em 0,1%). O IPI é reduzido a zero, exceto para produtos com similar produzido na Zona Franca de Manaus. Institui-se o Imposto Seletivo.

2029 a 2032 — transição estadual e municipal. O IBS sobe em frações de um décimo por ano (1/10 em 2029, 2/10 em 2030, 3/10 em 2031, 4/10 em 2032), enquanto ICMS e ISS são reduzidos na mesma proporção (90%, 80%, 70% e 60% do valor devido). Os benefícios fiscais de ICMS são reduzidos na mesma proporção.

2033 — sistema definitivo. ICMS e ISS são extintos. Vigora apenas o IBS somado à CBS.

Consequência contratual: contratos de execução continuada firmados hoje atravessarão mais de um regime tributário durante a própria vigência. Sem cláusula de revisão, a variação de carga recai integralmente sobre uma das partes por acaso, e não por negociação.` },

{
  titulo: 'Split payment e efeitos no fluxo de caixa e nos contratos',
  fonte: 'LC 214/2025 — síntese técnica Sattva',
  categoria: 'legislacao',
  conteudo: `O recolhimento do IBS e da CBS pode ocorrer na liquidação financeira da operação: no momento do pagamento, o prestador do serviço de pagamento segrega e destina diretamente ao fisco o montante correspondente aos tributos, creditando ao fornecedor apenas o valor líquido.

Efeitos práticos:
- O fornecedor deixa de ter a disponibilidade financeira do tributo entre o faturamento e o vencimento da guia, o que reduz capital de giro para empresas que hoje se financiam com esse prazo.
- A apropriação do crédito pelo adquirente tende a ser vinculada à extinção do débito na operação anterior, aumentando a relevância da idoneidade e da regularidade do fornecedor.
- Contratualmente, é essencial prever que a retenção realizada nessa sistemática equivale a pagamento, não caracterizando inadimplemento do contratante nem gerando mora, multa ou juros. Contratos silentes geram disputa sobre "pagamento integral" quando o fornecedor recebe menos do que o valor de face da nota.` },

{
  titulo: 'Créditos: quem gera, quem aproveita e onde o crédito se perde',
  fonte: 'Síntese técnica Sattva',
  categoria: 'creditos',
  conteudo: `Contribuinte do regime regular aproveita integralmente o IBS e a CBS destacados nas aquisições, inclusive sobre bens e serviços que hoje não geram crédito no PIS/COFINS não cumulativo nem no ICMS, como energia, comunicação, marketing, consultoria e a maior parte das despesas operacionais. É um alargamento relevante da base creditável.

Onde o crédito NÃO vem integral:
- Fornecedor optante pelo Simples Nacional que permanece no DAS: transfere ao adquirente apenas o valor de IBS e CBS embutido no DAS, muito inferior ao destaque de um fornecedor do regime regular. O mesmo fornecedor pode optar pelo regime regular do IBS/CBS, apurando por fora e destacando integralmente.
- MEI: não gera crédito relevante.
- Produtor rural pessoa física abaixo do limite de receita e demais não contribuintes: fora do regime regular, com regras próprias de crédito presumido em cadeias específicas.
- Entidades imunes e isentas: sem destaque na saída.
- Bens e serviços de uso e consumo pessoal: vedação expressa de crédito.

Consequência comercial: no novo modelo, comparar propostas pelo preço de nota passa a ser erro técnico. A comparação correta é pelo custo efetivo, isto é, preço menos crédito aproveitável. Um fornecedor do Simples com preço de nota menor pode ser mais caro que um do regime regular com preço maior.

Erro de classificação fiscal do fornecedor (NCM, NBS, cClassTrib) resulta em glosa de crédito no adquirente. Por isso a responsabilidade pela correta classificação deve estar expressa em contrato, com dever de ressarcimento.` },

{
  titulo: 'Regimes diferenciados, específicos e alíquota zero',
  fonte: 'LC 214/2025 — síntese técnica Sattva',
  categoria: 'legislacao',
  conteudo: `Redução de 60% da alíquota: serviços de educação, serviços de saúde, dispositivos médicos e de acessibilidade, medicamentos, alimentos destinados ao consumo humano, produtos de higiene e limpeza, insumos agropecuários, produções artísticas, culturais, jornalísticas e audiovisuais, comunicação institucional, transporte coletivo de passageiros, entre outros.

Redução de 30%: prestação de serviços de profissões intelectuais de natureza científica, literária ou artística submetidas a fiscalização por conselho profissional — advocacia, contabilidade, engenharia, arquitetura, medicina, odontologia, entre outras.

Alíquota zero: Cesta Básica Nacional de Alimentos, além de hipóteses específicas de medicamentos, dispositivos e serviços.

Regimes específicos, com base de cálculo ou alíquota próprias: combustíveis e lubrificantes (monofásico), serviços financeiros, planos de assistência à saúde, concursos de prognósticos, operações com bens imóveis, sociedades cooperativas, bares e restaurantes, hotelaria, parques, agências de turismo, transporte de passageiros e programas de mobilidade.

Exportação: imune, com manutenção integral dos créditos das aquisições, o que tende a gerar saldo credor acumulado e direito a ressarcimento — com efeito relevante de fluxo de caixa que deve ser planejado.

Importação: tributada, para equalizar a carga com o produto nacional.

Nota de aplicação: enquadrar uma operação em regime reduzido exige aderência do NCM ou da NBS e do código de classificação tributária. Enquadramento indevido é risco de autuação e de glosa do crédito na ponta seguinte da cadeia.` },

{
  titulo: 'Contratos administrativos e reequilíbrio econômico-financeiro',
  fonte: 'Síntese técnica Sattva',
  categoria: 'contratos',
  conteudo: `Contratos firmados com a Administração Pública têm regime próprio: a alteração da carga tributária que onere ou desonere o objeto contratado é causa de revisão do valor, para restabelecer a relação inicial entre encargos e retribuição.

Pontos de atenção:
- O pleito é formal e instruído: exige demonstrativo analítico do impacto, comparando a composição de custos da proposta original com a composição sob o novo regime. O sistema de diagnóstico produz exatamente esse demonstrativo.
- Há prazos e momentos próprios para o requerimento; a inércia até a prorrogação seguinte pode significar absorver a diferença.
- Órgãos públicos não aproveitam crédito de IBS e CBS. Existe previsão de redução de alíquota nas aquisições públicas com destinação do produto da arrecadação ao ente contratante, o que altera a equação de preço nesse mercado.
- Em contratos de longa duração com a Administração, é recomendável antecipar o tema antes da virada de 2027, quando o PIS e a COFINS são extintos e a CBS entra com alíquota cheia.` },

{
  titulo: 'Cláusulas contratuais: o que precisa estar escrito',
  fonte: 'Síntese técnica Sattva',
  categoria: 'contratos',
  conteudo: `Preço líquido com destaque em separado. Contratos que fixam preço "com todos os tributos inclusos" alocam a uma das partes, por acidente, todo o risco de variação de alíquota ao longo de uma transição de oito anos. A prática recomendada é pactuar o preço líquido de tributos e prever o acréscimo do IBS e da CBS nas alíquotas vigentes na data do fato gerador.

Reequilíbrio por alteração da legislação tributária. Cláusula expressa cobrindo criação, extinção, majoração, redução, mudança de base de cálculo, de regime de apuração ou do direito a crédito, com prazo definido para a revisão. Sem ela, não há direito automático à revisão de preço.

Garantia de destaque e transferência do crédito. Obrigação do fornecedor de emitir documento idôneo, com destaque correto e códigos de classificação exigidos, sob pena de ressarcir o crédito não aproveitado.

Adequação ao split payment. Reconhecimento de que a retenção na liquidação equivale a pagamento.

Comunicação de mudança de regime tributário. O fornecedor deve informar previamente alteração de regime, inclusive opção ou renúncia ao regime regular do IBS/CBS, com faculdade de revisão de preço quando reduzir o crédito apropriável.

Reajuste apartado da variação tributária. Índice de inflação incidindo sobre o preço líquido; a variação de carga tratada na cláusula de reequilíbrio.

Responsabilidade por classificação fiscal. NCM, NBS e cClassTrib corretos são responsabilidade de quem emite, com dever de indenizar glosas e multas suportadas pelo adquirente.

Devoluções e ajustes. Previsão de emissão dos documentos próprios para estorno ou complemento de IBS e CBS no período de apuração do evento.

Contratos de longa duração. Reconhecimento expresso de que a execução atravessa regimes distintos, aplicando-se a cada faturamento a legislação vigente na data do fato gerador.` },

{
  titulo: 'Impactos por regime tributário do contribuinte',
  fonte: 'Síntese técnica Sattva',
  categoria: 'diagnostico',
  conteudo: `Lucro Real. Já apura PIS e COFINS de forma não cumulativa a 9,25% e credita ICMS. É o perfil que menos sente a mudança na tomada de crédito, mas ganha com o alargamento da base creditável para despesas hoje não creditáveis.

Lucro Presumido. Hoje recolhe PIS e COFINS cumulativos a 3,65% sem direito a crédito. No novo modelo credita integralmente as entradas, o que representa ganho relevante, mas a alíquota de saída sobe fortemente, sobretudo em serviços com baixa participação de insumos. É o perfil que mais exige reposicionamento de preço.

Simples Nacional. Permanece com o recolhimento unificado pelo DAS, mas passa a ter uma decisão estratégica: manter-se no DAS, transferindo crédito reduzido ao adquirente, ou optar pelo regime regular de IBS e CBS, apurando por fora, creditando as entradas e destacando integralmente nas saídas. A escolha depende do perfil da carteira: quem vende para pessoas físicas tende a permanecer no DAS; quem vende para empresas do regime regular pode perder competitividade se não migrar.

MEI. Não gera crédito relevante ao adquirente. Cadeias com participação significativa de MEI perdem atratividade no novo modelo.

Prestadores de serviço em geral. Como a carga de serviços hoje é comparativamente menor (ISS somado a PIS/COFINS) e a base de insumos creditáveis é pequena, o setor de serviços concentra o maior aumento de carga efetiva na reforma, mitigado pelas reduções de 30% e 60% quando aplicáveis.` },
];

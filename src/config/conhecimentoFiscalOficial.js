/**
 * Complemento curado da base RAG do Especialista Fiscal Sênior.
 * Não é matriz de cálculo e não publica regras no motor.
 */
module.exports = [
  {
    titulo: 'PIS/Cofins: fontes normativas e precedência de análise',
    fonte: 'Fontes oficiais: https://www.planalto.gov.br/ccivil_03/leis/2002/l10637.htm ; https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm ; https://normas.receita.fazenda.gov.br/sijut2consulta/consulta.action?termoBusca=2121',
    categoria: 'legislacao_oficial_pis_cofins',
    conteudo: `Vigência e uso: esta referência organiza a leitura da legislação de PIS/Pasep e Cofins atual, sem substituir o texto legal nem o catálogo fiscal estruturado do Sattva.

Fontes primárias: Lei nº 10.637/2002 disciplina a incidência não cumulativa do PIS/Pasep; Lei nº 10.833/2003 disciplina a incidência não cumulativa da Cofins; a IN RFB nº 2.121/2022 consolida normas de apuração, cobrança, fiscalização, arrecadação e administração de PIS/Pasep, Cofins e contribuições na importação.

Regra de uso pelo Especialista: a identificação de NCM, NBS, CST, natureza, regime, papel na cadeia e condições continua sendo resolvida primeiro pela matriz e pelos fatos estruturados do sistema. Esta base jurídica serve para explicar fundamento, apontar evidência faltante e delimitar a conclusão. Não se deve trocar automaticamente o tratamento calculado apenas porque o documento fiscal histórico declarou outro CST ou outra alíquota.

Quando houver benefício, monofasia, suspensão, alíquota zero, substituição ou crédito, a resposta deve informar a norma específica aplicável, a vigência e os fatos que faltam para confirmar a hipótese. Na ausência desses fatos, a conclusão correta é "requer validação", e não a presunção de alíquota geral.`
  },
  {
    titulo: 'PIS/Cofins não cumulativo: crédito, evidência e limites',
    fonte: 'Fontes oficiais: https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/ecf/PeRPJ2022v1.pdf ; https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/jurisprudencia-vinculante/pis-cofins',
    categoria: 'legislacao_oficial_pis_cofins',
    conteudo: `Vigência e uso: esta referência apoia a explicação da reconstrução da carga e da análise de crédito de PIS/Cofins. A apuração do Sattva não presume crédito apenas porque existe carga tributária no fornecedor.

Nas hipóteses não cumulativas, a legislação e a orientação oficial tratam créditos a partir das aquisições, da natureza da despesa ou insumo, da vinculação à atividade e das vedações específicas. O conceito de insumo deve ser analisado pela essencialidade ou relevância, conforme a jurisprudência vinculante listada pela Receita Federal. Isso exige evidência da operação e não pode ser concluído somente por NCM, NBS ou CST do documento.

Regra operacional: carga atual reconstruída do fornecedor e crédito atual do adquirente são análises distintas. O sistema mantém a lógica de crédito já comprovadamente estruturada; caso os fatos indispensáveis não existam, deve expor a pendência e não transformar a reconstrução da carga do fornecedor em crédito do adquirente.`
  },
  {
    titulo: 'Reforma do consumo: hierarquia normativa, transição e limites',
    fonte: 'Fontes oficiais: https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm ; https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm',
    categoria: 'legislacao_oficial_reforma',
    conteudo: `Vigência e uso: a EC nº 132/2023 alterou o Sistema Tributário Nacional e estabeleceu a transição constitucional. A Lei Complementar nº 214/2025 institui IBS, CBS e Imposto Seletivo, além de disciplinar aspectos do novo regime.

O Especialista deve distinguir: regra constitucional de transição; regra da LC nº 214/2025; regulamento, documento técnico ou tabela oficial; e parâmetro interno de cenário. Uma estimativa, alíquota de referência ou premissa de cenário não substitui a alíquota legal aplicável à competência.

Nas respostas, informar sempre a competência analisada. A reforma não autoriza transportar automaticamente benefício de PIS/Cofins para CBS, nem interpretar cClassTrib como regra de PIS/Cofins. Benefícios e condições devem ser tratados na matriz própria de cada tributo e somente quando a chave e os fatos estruturados comprovarem a hipótese.`
  },
  {
    titulo: 'IBS/CBS: classificação tributária e documentos fiscais',
    fonte: 'Fontes oficiais: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=%2FNJarYc9nus%3D ; https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc',
    categoria: 'documentos_fiscais_oficiais',
    conteudo: `Vigência e uso: as tabelas e notas técnicas oficiais de documentos fiscais estruturam CST, cClassTrib e regras de validação para IBS/CBS. A correlação de serviço, NBS, cClassTrib e indicador de operação deve usar a versão oficial aplicável ao documento e à competência.

Regra operacional: CST e cClassTrib presentes no XML são evidência histórica de emissão. Eles não prevalecem automaticamente quando uma regra fiscal vigente foi resolvida por chave e fatos estruturados. Por outro lado, a ausência de CST ou cClassTrib no documento não prova que a operação esteja sem tratamento: o motor segue sua ordem de precedência e registra a origem da classificação.

O Especialista deve citar a tabela técnica como referência de documento e separar claramente classificação declarada, classificação resolvida pelo motor e pendência de fato. Não deve criar códigos, correlacionar NBS por similaridade textual livre ou substituir o catálogo operacional por texto recuperado no RAG.`
  },
  {
    titulo: 'Contrato operacional Sattva: precedência, evidência e autonomia',
    fonte: 'Política interna Sattva — contrato do motor fiscal, revisado em 2026-09',
    categoria: 'governanca_interna',
    conteudo: `Este documento descreve o contrato de uso entre o Especialista Fiscal Sênior e os motores do Sattva.

Precedência de classificação: regra específica por NCM; regra específica por NBS/LC116; condição automática somente com todos os fatos indispensáveis disponíveis; regra residual de regime quando permitida; indeterminado quando faltar fato essencial. A condição societária do cClassTrib 200044 resolve a hipótese de IBS/CBS quando o cadastro comprova sócio brasileiro com participação mínima exigida; ela não cria regra de PIS/Cofins.

Documento fiscal é evidência histórica. Divergência entre documento e regra resolvida deve ser explicada e registrada; não deve alterar automaticamente a norma aplicada. NCM/NBS e tratamentos de cálculo pertencem aos catálogos estruturados e versionados. O RAG não promove regras, não recalcula resultados e não altera dados.

Autonomia só é considerada quando a decisão foi resolvida por regra e fatos comprovados. Se houver fato essencial ausente, a resposta declara qual é o fato, a origem esperada e o efeito sobre a conclusão.`
  }
];

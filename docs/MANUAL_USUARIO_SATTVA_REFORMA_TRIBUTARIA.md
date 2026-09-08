# Manual do Usuário Sattva Reforma Tributária

Este manual descreve a operação da versão atual do Sattva Reforma Tributária. O sistema usa uma única base de dados por empresa: os dados entram na **Central de Dados**, são tratados e rastreados e, depois, alimentam os módulos de análise, planejamento e entrega ao cliente.

**Regra central:** informação ausente nunca é tratada como zero. O sistema mostra a pendência, permite uma declaração auditável quando aplicável e identifica o que é real, calculado, projetado ou ainda indeterminado.

## 1. Acesso, empresa e aparência

Entre com e-mail e senha. Use **Esqueci minha senha** quando necessário.

Depois do acesso, o sistema abre a **Visão geral da carteira**. Ela não depende de uma empresa selecionada: mostra a quantidade de projetos, seus estágios, evolução e entregas concluídas. Use **Ir para projetos** para acessar a gestão dos escopos ou **Abrir projeto** em um card para abrir diretamente a empresa correspondente.

Depois de entrar em um projeto, confirme a empresa no seletor do canto superior direito ou no menu lateral. A empresa selecionada é usada nos módulos individuais; confirme-a antes de importar, executar cálculos ou gerar uma entrega.

No menu do seu nome, no canto superior direito, estão:

- **Claro** e **Escuro**, para alterar apenas a aparência visual. A preferência fica salva neste navegador e não altera dados, regras ou cálculos.
- **Manuais do sistema**, para consultar ou baixar a versão publicada deste manual.
- **Redefinir senha** e **Sair**.

Os grupos do menu lateral podem ser recolhidos ou expandidos pelo respectivo título.

## 2. Estrutura do sistema

### Visão geral da carteira

É a porta de entrada do sistema. Os cartões resumem projetos ativos, evolução média, entregas concluídas e atenções abertas. O gráfico de barras distribui os projetos por estágio. Em cada projeto, a barra representa a evolução do escopo e o símbolo **✓** marca entregas já concluídas. Essa tela é somente de acompanhamento: nenhum cálculo ou cadastro é alterado nela.

### Central de Dados

É a entrada e o controle da análise. Nela ficam o período analisado, documentos, folha, outras receitas, apurações, margem, empresas, cadastros compartilhados e bases fiscais.

### Módulo 1 Diagnóstico

Mostra a operação atual e seus efeitos: Perfil Tributário, Cadeia de Fornecedores, Cadeia de Clientes, Impacto da CBS, Cenários, Cobertura, Conformidade e Mapa Operacional.

### Módulos 2 a 7

- **Módulo 2 - Precificação:** efeito tributário sobre preço, custo e margem.
- **Módulo 3 - Contratos:** revisão e acompanhamento das adequações contratuais.
- **Módulo 4 - Capacitação:** programação das turmas e acompanhamento de participantes.
- **Módulo 5 - Planejamento tributário:** comparação de regimes, projeções e recomendações.
- **Módulo 6 - Acompanhamento:** tarefas, baseline, realizado e evolução do projeto.
- **Módulo 7 - Entregável ao cliente:** consolida a apresentação do trabalho para o cliente.

Um módulo ou submódulo pode ser **fechado** quando estiver revisado. O fechamento protege aquela parte contra novos cálculos; use **Reabrir** somente se precisar alterar dados ou executar novamente o motor. O Entregável ao Cliente só fica disponível quando as partes necessárias estiverem fechadas.

## 3. Cadastro de empresas e estabelecimentos

Acesse **Central de Dados > Empresas e estabelecimentos**.

Cadastre ou edite razão social, CNPJ, regime tributário, enquadramento IVA, localização, atividade e demais campos disponíveis. Ao informar o CNPJ, use a consulta cadastral para preencher dados oficiais quando disponível.

Confira especialmente:

- CNAE principal e CNAEs secundários;
- endereço e natureza jurídica;
- quadro societário (QSA), percentual de cotas e indicação de sócio brasileiro ou estrangeiro;
- regime tributário informado pela empresa e a fonte desse regime.

O sistema preserva uma confirmação manual de QSA. Uma nova consulta cadastral complementa informações, mas não deve substituir confirmação manual já registrada.

## 4. Cadastros compartilhados e parceiros

Em **Cadastros compartilhados**, consulte CNPJs já encontrados nas operações da carteira. Um cadastro enriquecido pode ser reutilizado por outras empresas, evitando consultas repetidas.

O perfil compartilhado pode exibir razão social, CNAE, endereço, natureza jurídica, regime, fonte e etiquetas fiscais. As etiquetas aparecem somente quando influenciam o tratamento, por exemplo, para ente público elegível; parceiros sem condição especial permanecem como operação normal.

Use filtros por CNPJ/razão social, regime, CNAE/endereço, natureza, etiqueta e fonte para localizar registros. **Ver cadastro** abre o perfil completo.

Em **Consultar regime na base importada**, não marque **Sobrescrever regimes já definidos** sem necessidade. A consulta complementa dados faltantes; o regime manualmente confirmado deve permanecer preservado.

## 5. Central de Dados e prontidão

Acesse **Central de Dados**. O cabeçalho da área é sempre Central de Dados; cada card identifica a etapa aberta.

O **Dashboard** mostra a prontidão das entregas. Em cada etapa, o status é:

- **Verde - Liberado:** o dado foi importado, preenchido ou declarado de forma auditável.
- **Vermelho - Pendências:** há algo a resolver. Clique no status para ver exatamente quais competências ou informações faltam.

Não há status amarelo. Uma informação está resolvida ou exige ação.

### Período analisado

Antes de importar documentos, abra **Período analisado** e defina competência inicial e final no formato mês/ano. O sistema considera o primeiro dia do mês inicial e o último dia do mês final.

Essa definição protege a consistência: a Central compara os arquivos e lançamentos com o período escolhido e aponta competências faltantes. Sem período definido, a importação de documentos fica bloqueada.

### O que cada etapa verifica

| Etapa | Como resolver | O que o sistema confere |
|---|---|---|
| Documentos fiscais | Importar planilha, XML ou SPED, ou declarar sem movimento | Cobertura do período analisado |
| Folha | Informar manualmente, importar planilha ou declarar ausência | Competências da folha e pró-labore no período |
| Outras receitas | Informar, importar ou declarar que não se aplica | Competências sem documento fiscal eletrônico |
| Apurações | Importar apurações conforme o regime | Período analisado e dois anos anteriores quando necessários ao planejamento |
| Margem operacional | Informar a margem | Premissa de margem para cenários, planejamento e precificação |
| Empresas e estabelecimentos | Completar cadastro | CNAEs e QSA, quando aplicáveis |

Empresas novas podem não ter dados dos dois anos anteriores. Nessa situação, use a declaração disponível e registre a justificativa. O sistema pode projetar, mas identificará a limitação na recomendação.

## 6. Documentos fiscais

Abra **Central de Dados > Documentos fiscais** e escolha a origem: **Entradas / fornecedores** ou **Saídas / clientes**.

### Planilhas

Use a aba **Planilhas** para cadastrar parceiros e importar movimentações. Baixe o modelo quando necessário. Após a importação, confira total de linhas, campos reconhecidos, lotes e pendências.

### XML e SPED

Use a aba **XML e SPED** para importar documentos fiscais e arquivos SPED. O sistema lê CFOP, NCM, NBS, CST, valores, participantes e demais dados disponíveis, preservando o documento original como evidência.

O **CFOP** é convertido em natureza operacional pelo mapa de CFOP. Assim, o motor distingue venda, aquisição, devolução, remessa, transferência, importação e exportação antes de analisar regras de item e de destinatário.

Se não houver movimento no período, use **Declarar sem movimento** e informe a justificativa. Não importe valores zerados apenas para liberar uma etapa.

## 7. Folha, outras receitas, apurações e margem

### Folha

Em **Folha**, informe competência, valor da folha e, quando houver, pró-labore. Também é possível importar planilha ou declarar ausência. A folha é usada no planejamento, inclusive para a projeção de INSS e análise de Fator R quando aplicável.

### Outras receitas

Em **Outras receitas**, registre receitas que não vieram de documento fiscal eletrônico. Informe ou importe competência, tipo, descrição, valor e referência. Possíveis duplicidades ficam identificadas e não devem ser consolidadas sem revisão.

### Apurações

Em **Apurações**, importe os documentos adequados ao regime:

- empresas do Simples: PGDAS mensal;
- Lucro Presumido, Lucro Real, Arbitrado ou Imune/Isento: faturamento e apurações de PIS/Cofins conforme a tela solicitar.

Para o Planejamento Tributário, são solicitados o período analisado e os dois anos anteriores. Para exemplo: análise em 2026 pode exigir 2026, 2025 e 2024. Se o documento for PDF ou imagem, a leitura automatizada deve ser revisada e confirmada antes de ser usada como evidência.

### Margem operacional

Em **Margem operacional**, informe a margem operacional como premissa. Ela ajuda a medir preservação de margem, revisão de preço e impacto tributário, mas não substitui o lucro tributável definitivo.

## 8. Executar o motor

**Executar motor** é uma etapa própria da Central de Dados. Ele só fica verde e habilitado quando:

1. o período analisado foi definido;
2. documentos fiscais foram resolvidos para o período;
3. outras receitas foram resolvidas para o período.

O motor lê a mesma base importada, classifica cada operação e produz a projeção. Ele usa, entre outros fatores, CFOP/natureza, NCM ou NBS, regra de classificação, regime do emitente e adquirente, papel na cadeia, destinatário e condições específicas.

Não use o motor para corrigir documento histórico. Corrija o cadastro, complete a informação ou registre uma decisão rastreável na Central de Dados e então execute novamente.

## 9. Regras e parâmetros do motor

Em **Gestão do produto > Regras e parâmetros do motor**, os parâmetros técnicos ficam organizados por assunto.

- **Alíquotas e transição:** valores de IBS/CBS por ano e regras de vigência.
- **Forma de cálculo:** como cada tributo participa da base econômica.
- **Regimes e crédito:** comportamento de crédito e recolhimento por regime.
- **Reduções:** percentuais gerais; regras específicas de NCM/NBS prevalecem quando existirem.
- **Simples Nacional:** faixas e premissas vinculadas ao DAS.
- **Mapa de natureza por CFOP:** traduz CFOP em natureza operacional para o motor.
- **Limiares e padrões:** limiares definem alertas e relevância; padrões só são usados quando o documento não traz o valor e ficam marcados como estimativa.
- **Ensaio de regra:** simulação sem gravação de uma operação completa.
- **Histórico:** registro das alterações de parâmetros.

No **Ensaio de regra**, informe valor, papel da empresa na cadeia, regimes do emitente e destinatário, CFOP, NCM ou LC 116/NBS e fatos condicionais. O resultado mostra classificação, CST, cClassTrib, tratamento CBS, crédito, fundamentos e reconstrução da carga atual. Nada informado nessa tela modifica empresas reais.

## 10. Diagnóstico

### Perfil Tributário

O Perfil Tributário é o retrato da operação atual. Ele apresenta o regime em nome legível, apurações de PIS/Cofins ou PGDAS e a separação disponível entre tributação normal, monofásica, alíquota zero, isenção e alíquota efetiva final.

O objetivo não é repetir o motor. Ele fornece a carga atual para comparação posterior com a CBS no **Impacto da CBS**.

### Cadeia de fornecedores

Analisa o efeito das compras. Considera dados atuais de PIS/Cofins e projeta CBS conforme regime do fornecedor, classificação, NCM/NBS, benefícios, natureza da operação e direito a crédito. Crédito indeterminado não vira crédito zero automaticamente.

### Cadeia de clientes

Analisa o efeito das vendas. Considera destinatário, regime, classificação, benefícios, cClassTrib e condições específicas, inclusive hipóteses relacionadas a governo quando os fatos cadastrais estiverem confirmados.

### Impacto da CBS

Consolida Cadeia de Fornecedores e Cadeia de Clientes e compara o resultado com o Perfil Tributário. Ele mostra o efeito da CBS sobre a operação atual; não é uma segunda apuração independente.

### Cenários

Usados para testar objetivos como preservação de margem, preservação de preço e repasse parcial ou integral. Cenários são sempre identificados como projeção e alimentam Planejamento Tributário, Precificação e Contratos.

### Conformidade e mapa operacional

**Conformidade** organiza divergências documentais e fiscais para revisão. Nem toda diferença é um erro material: uma alteração de NBS ou NCM só é relevante quando muda o tratamento tributário, crédito ou obrigação.

O **Mapa Operacional** parte das atividades da empresa e usa o tipo de documento emitido apenas para decidir se deve mostrar hipóteses de mercadoria, serviço ou ambas. Ele relaciona atividades a NCM ou LC 116/NBS potenciais, PIS/Cofins atual, CBS/cClassTrib, INDOP e condições para aplicação. É indicativo: não entra no motor até haver confirmação apropriada.

## 11. Planejamento Tributário

No **Módulo 5 - Planejamento tributário**, crie um estudo e selecione uma ou mais empresas. O sistema calcula cada empresa individualmente e também pode apresentar o consolidado do grupo.

O planejamento projeta receita e folha para doze meses. Quando houver histórico mensal suficiente, usa a distribuição mensal para reduzir distorções de sazonalidade; quando não houver, usa projeção linear e identifica o risco.

Para Simples Nacional, o PGDAS dos anos necessários melhora a projeção de receita e o risco de saída do regime. Para regimes regulares, faturamento mensal e apurações de PIS/Cofins dos mesmos períodos permitem estimativa mais consistente. Folha e pró-labore são usados para o INSS projetado; para atividades sujeitas ao Fator R, o sistema alerta para revisão do usuário.

Leia sempre as premissas, os dados reais, projeções e justificativas antes de aprovar uma recomendação. A recomendação não substitui a decisão do responsável técnico.

## 12. Precificação, contratos, capacitação e acompanhamento

### Precificação

O **Módulo 2** transforma o impacto tributário em efeito sobre preço, custo líquido e margem. Use formação de custo e saídas oficiais como base. Um dado incompleto deve ser completado, não estimado silenciosamente.

### Contratos

No **Módulo 3**, cadastre e revise contratos para identificar cláusulas, riscos, vigências e providências de adequação. Leituras automatizadas ou sugestões exigem revisão humana antes de decisão.

### Capacitação

No **Módulo 4**, programe turmas, participantes, presença e evidências da capacitação. Use o escopo contratado e as necessidades identificadas no diagnóstico como referência.

### Acompanhamento

No **Módulo 6**, registre tarefas, responsáveis, prazo, baseline, realizado, evidências e pendências do cliente. O acompanhamento não altera o escopo contratado; ele acompanha a execução dele.

### SLA, marcos e tarefas obrigatórias

Em **Gestão do Produto > SLA e prazos**, configure os marcos do projeto, o prazo de cada um em dias e a sua precedência. Um marco sem precedente começa na contratação; os demais começam ao término do marco indicado. No mesmo cadastro, inclua as tarefas-modelo obrigatórias de cada etapa, como importar folha, importar apurações/PGDAS e executar o motor.

Quando um novo escopo é aprovado, essas tarefas são criadas automaticamente dentro da entrega correspondente e recebem as datas do marco. Em projetos já existentes, use **Aplicar SLA** em Escopo e entregas: ele cria somente as tarefas obrigatórias ainda ausentes, sem apagar tarefas ou prazos registrados.

Tarefas marcadas como **SLA obrigatório** não aceitam alteração direta de prazo. Use **Prorrogar prazo**, informe a nova data e a justificativa. A prorrogação é registrada e recalcula as datas dos marcos seguintes que dependem daquela entrega; o Gantt reflete a nova sequência.

## 13. Entregável ao Cliente

O **Módulo 7 - Entregável ao Cliente** organiza a apresentação final com a seguinte narrativa:

1. informações da empresa: nome, CNPJ e CNAEs;
2. Perfil Tributário;
3. Cadeia de Fornecedores;
4. Cadeia de Clientes;
5. Impacto da CBS;
6. Conformidade Documental;
7. Cenários;
8. Planejamento Tributário.

Antes de gerar ou compartilhar a entrega, confira empresa, período, fonte dos dados, pendências, módulos fechados e se os resultados são reais, calculados ou projetados. Reabra o submódulo correspondente se houver necessidade de novo cálculo ou correção.

## 14. Estados e cuidados de interpretação

| Estado | Significado |
|---|---|
| REAL | Informação recebida de documento, cadastro ou fonte identificada. |
| CALCULADO | Resultado produzido pelo sistema a partir de dados e regras. |
| PROJETADO ou SIMULADO | Resultado dependente de cenário, estimativa ou premissa. |
| INTERPRETADO ou SUGERIDO | Leitura ou recomendação que exige revisão humana. |
| INDETERMINADO ou INCOMPLETO | Não há evidência suficiente para concluir. |
| PENDENTE | Falta uma condição, confirmação ou informação para aplicar uma regra. |

Use rastreabilidade, fonte e fundamentos exibidos na tela para entender cada número. Não transforme pendência em certeza por meio de preenchimento artificial.

## 15. Erros comuns e solução

| Situação | O que fazer |
|---|---|
| O motor está bloqueado | Abra Executar motor, leia as pendências e resolva Documentos fiscais e Outras receitas no período analisado. |
| Uma etapa está vermelha | Clique no status vermelho para ver as competências ou campos pendentes. |
| Não existe histórico de dois anos | Registre declaração de empresa nova ou início posterior e justifique. |
| Regime de parceiro parece incorreto | Confira a fonte. Não sobrescreva uma definição manual sem revisão. |
| Benefício público não foi aplicado | Verifique natureza jurídica do destinatário, item, operação e condição legal. |
| Regra 200044 está pendente | Confirme se há sócio brasileiro com participação de pelo menos 20%. |
| NCM ou NBS tem mais de uma hipótese | Revise item, operação e condições; o sistema não deve escolher arbitrariamente. |
| Um resultado é diferente do histórico | Compare período, documento, classificação, regra e se o resultado é real ou projetado. |

## 16. Sequência recomendada de trabalho

1. Selecionar e completar a empresa.
2. Definir o período analisado.
3. Importar documentos fiscais e completar dados complementares.
4. Resolver as pendências vermelhas da Central de Dados.
5. Executar o motor.
6. Revisar Perfil Tributário, cadeias, impacto, conformidade e cenários.
7. Construir o Planejamento Tributário e as ações de preço, contrato e capacitação.
8. Fechar os submódulos revisados.
9. Gerar e revisar o Entregável ao Cliente.

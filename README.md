# Sattva — Implementação da Reforma Tributária

Sistema para executar o produto descrito na Cartilha: diagnóstico, acompanhamento, precificação, revisão de contratos e capacitação — com uma calculadora que volta a base dos impostos e projeta o IVA Dual ano a ano.

## Atualizando de uma versão anterior

Basta substituir os arquivos e rodar `npm install` e `npm start`. O banco é migrado automaticamente na inicialização: as colunas novas são acrescentadas às tabelas existentes e os dados são preservados. O console informa quantas colunas foram acrescentadas.

Não é preciso apagar `dados/reforma.db` — e não se deve, se já houver empresas e movimentação cadastradas.

## Instalação

Requisito: **Node.js 22 ou superior** (recomendado 24 LTS).

```bash
npm install
npm start
```

Nenhuma dependência compila código nativo — não precisa de Visual Studio, Windows SDK nem Python. O banco usa o SQLite embutido no próprio Node (`node:sqlite`).

No Node.js 22 o módulo ainda é experimental e exige a flag:

```bash
node --experimental-sqlite server.js
```

No Node 24 basta `npm start`.

Abra `http://localhost:3200`.

O banco (SQLite) é criado sozinho em `dados/reforma.db`. Para colocar em outro lugar (pasta de rede, por exemplo), crie um `.env`:

```
PORTA=3200
SATTVA_DADOS=C:\Sattva\reforma\dados
```

## O que o sistema faz

### Módulo 1 — Diagnóstico

| Tela | O que entrega |
|---|---|
### Motor de análise e projeção tributária

O motor usa a fotografia da operação atual (XML, planilha ou SPED) para projetar como as mesmas operações se comportam no modelo IBS/CBS. Os documentos importados **não** trazem CBS, IBS, CST IBS/CBS nem cClassTrib — o motor não espera encontrá-los; ele os deduz.

**Ordem de processamento, sempre nesta sequência:**

```
CLASSIFICAÇÃO → TRATAMENTO → BASE → ALÍQUOTA → TRIBUTO → CRÉDITO
```

Nunca se calcula antes de classificar.

**Voltar à base econômica.** Cada tributo sai da composição conforme a própria forma de cálculo, não por subtração cega:

| Tributo | Forma | Sai da base? |
|---|---|---|
| ICMS, ISS | por dentro — integram o preço | sim |
| PIS/COFINS | por dentro no preço | sim (estimado pelo regime quando não destacado) |
| IPI, ICMS-ST | por fora — somam ao preço | **não** — nunca estiveram na base |
| Frete, seguro, outras despesas | custo real | não |

Três valores ficam sempre registrados e o original do documento nunca é sobrescrito: **preço atual**, **base econômica reconstruída** e **preço projetado IBS/CBS**. Quando falta informação, a base é marcada como *estimada sujeita à validação*.

**Fornecedor do Simples sem faturamento conhecido.** O motor não arbitra uma alíquota: simula cinco faixas representativas e mostra o crédito transmitido em cada uma, mais o cenário híbrido (IBS/CBS pelo regime regular). Todos marcados como SIMULADO. Conhecido o faturamento real, a simulação é substituída por cálculo específico.

**Natureza do dado.** Todo número carrega REAL (regime ou faturamento conhecido), CALCULADO (decorre de regra conhecida) ou SIMULADO (depende de hipótese). Cenário nunca vira informação confirmada.

**Alíquotas.** Vivem na tabela `param_aliquotas`, editáveis, nunca no código. Enquanto dependerem de definição legal, aparecem como ALÍQUOTA PARAMETRIZADA PARA SIMULAÇÃO — nunca como alíquota definitiva.

**Rastreabilidade.** Cada item responde "de onde veio este número": documento, item, contraparte, regime, valores originais, fórmula de reconstrução, base, NCM/NBS, CST, cClassTrib, tratamento, alíquota, redução, tributo, crédito e a regra usada. Botão *Rastro* na tela de Classificações.

**Onde o motor aparece.** Nas telas que já existem, como aba adicional — nenhuma etapa nova, nenhuma mudança de navegação:

| Tela existente | Aba acrescentada |
|---|---|
| Cadastros e importação | XML e motor (importação de XML + execução) |
| Cadeia de fornecedores | Projeção IBS/CBS (item 34) |
| Cadeia de clientes | Projeção IBS/CBS + comparador de perfis (itens 35 e 24) |
| Projeção de cenários | Simulações tributárias (item 38) |
| Bases de classificação | Classificações (item 36) e Conformidade (item 37) |

**Importação de SPED.** EFD ICMS/IPI (SPED Fiscal) e EFD Contribuições, convertidos para a mesma estrutura comum do XML.

Registros lidos: `0000` (declarante e período), `0150` (participantes), `0200` (cadastro de itens — é daqui que sai o NCM, porque o C170 não o traz), `C100`/`C170` (mercadorias), `C190` (totais por CST/CFOP, usado quando não há C170), `D100` (transporte), `A100`/`A170` (serviços). Documentos cancelados ou denegados são descartados. O arquivo é decodificado como ISO-8859-1 ou UTF-8 conforme o conteúdo, para não corromper as descrições.

Vantagem sobre o XML: o sentido da operação já vem pronto no campo `IND_OPER` — não precisa ser deduzido pelo CNPJ.

Duas limitações do leiaute que aparecem como aviso na importação, e que não são falha do sistema:

- **O SPED não informa o regime tributário dos participantes.** O registro 0150 traz nome, CNPJ e endereço, e nada mais. Enquanto o XML ao menos sugere o regime do emitente pelo CRT, aqui não há nem essa pista — todo participante entra sem regime e vira apontamento de conformidade até o cadastro ser completado. Sem isso, a projeção de crédito não é confiável.
- **Escrituração de perfil B não envia o C170.** O detalhe chega agregado no C190, por CST e CFOP, sem produto e sem NCM. Esses lançamentos entram como "sem correspondência" na classificação, o que é o resultado correto — não há o que classificar.

**Importação de XML.** NF-e, NFC-e, CT-e e NFS-e. O sentido da operação sai da comparação do CNPJ da empresa com emitente e destinatário: destinatário → entrada/fornecedor; emitente → saída/cliente; nenhum dos dois → requer validação. O CRT do XML sugere o regime do emitente (distingue Simples de regime normal, mas **não** separa Lucro Real de Presumido) — por isso o cadastro de parceiros sempre prevalece.

### Entregáveis alimentados pelo motor

| Entregável | Onde | Conteúdo |
|---|---|---|
| **Relatório técnico** | Painel · aba Simulações | Sumário, projeção por fornecedor e por cliente, classificação item a item com rastreabilidade completa e conformidade |
| **Mapa de riscos** | Painel · Cenários → aba Mapa de riscos | Riscos derivados dos itens reais, com valor exposto, evidências e ação recomendada |
| **Simulações tributárias** | Cenários → aba Simulações | Apuração separada de IBS e CBS, carga atual × projetada |
| **Plano de adequação** | Plano | Recebe uma ação por risco, sem duplicar o que já existe |

O Mapa de riscos avalia sete dimensões — crédito, classificação, cadastro, base econômica, carteira, fluxo de caixa e margem — e cada risco carrega o valor exposto, a participação sobre o volume analisado e as evidências que o originaram. Nada é regra genérica: tudo sai dos itens efetivamente importados.

A aba *Classificações* do relatório técnico traz, por item: preço atual, base econômica, fórmula de reconstrução usada, CST IBS/CBS, cClassTrib, origem da regra, fundamento legal, alíquotas, tributo, crédito, status e a natureza do dado (REAL, CALCULADO ou SIMULADO). É a planilha que responde "de onde veio este número" sem depender do sistema aberto.

### Cenários — simulação da cadeia por grupos e percentuais

O consultor simula alterando a **composição percentual** da cadeia, não fornecedor a fornecedor. Mas o cálculo nunca acontece sobre o agregado: o percentual é expandido de volta ao detalhe e os mesmos motores tributários rodam de novo.

```
dados detalhados → classificação → motores → resultado base
   → agregação em dimensões → premissas percentuais
   → EXPANSÃO em overrides por item → motores DE NOVO
   → resultado do cenário → comparação → drill-down
```

**Expansão proporcional.** "Migrar 40% do grupo Simples" não escolhe quais fornecedores migram: cada lançamento do grupo migra 40% do próprio valor. Um item de R$ 10.000 vira duas linhas virtuais — R$ 6.000 na origem e R$ 4.000 no destino — mantendo NCM, classificação e tratamento. O mix tributário do grupo é preservado exatamente e o resultado é determinístico.

**Dimensão x visão.** Dimensão é partição mutuamente exclusiva e exaustiva: cada item cai em um grupo só. Apenas nelas os percentuais somam 100% e apenas nelas existe migração — é o que impede dupla contagem. Visão é filtro arbitrário (Top 10, região), serve para ler, nunca para migrar.

Dimensões implementadas: regime do fornecedor, comportamento de crédito, perfil do cliente, sensibilidade ao crédito, natureza da operação e tratamento tributário.

**Soma 100% por construção.** Migração é transferência dentro da mesma dimensão: o que sai de um grupo entra em outro. O sistema não redistribui nada silenciosamente — aumentar um grupo exige declarar de onde veio.

**Precedência das premissas:**

```
individual > grupo (migração) > global > dado original
```

Cada campo registra qual nível o determinou, e isso viaja até a memória de cálculo. Um item com premissa individual não é partido pela migração do grupo — a exceção vale inteira.

**Três efeitos separados.** Preço bruto é constante por padrão; variação de preço é premissa explícita. O sistema decompõe:

| Efeito | O que mede |
|---|---|
| comercial | variação do preço bruto negociado |
| tributário | IBS/CBS que passa a incidir por fora |
| líquido | variação do custo efetivo |

Isso importa porque **mais crédito não é automaticamente melhor**: no teste real, migrar 40% do Simples aumentou o crédito em R$ 2.630 mas elevou o custo efetivo em R$ 680 — o tributo destacado subiu mais que o crédito recuperado.

**Memória em dois níveis.** Nível 1 mostra como o agregado foi construído e quanto migrou de onde para onde. Nível 2 desce até o documento, com fórmula da base, CST, cClassTrib, origem da regra e a fração migrada. A reconciliação prova que a soma dos grupos bate com a soma do detalhe.

**Versionamento.** Cenário calculado é imutável; editar cria nova versão apontando para a anterior. A versão 0 é o cenário base e não pode ser excluída.

**Crédito nunca vira zero por ausência de dado.** O crédito é decomposto em quatro naturezas, e a interface deve exibir esta decomposição, não o total seco:

| Natureza | Significado |
|---|---|
| confirmado | calculado com dados reais |
| simulado | depende de hipótese do cenário |
| sem direito | zero **apurado** — o adquirente não se apropria. É conclusão |
| indeterminado | NÃO DETERMINADO — falta informação. **Não é zero** |

Na Truston, 97,89% da receita cai em "indeterminado": o XML de saída não informa o regime do tomador. A cobertura da análise é 2,11%, e o sistema diz isso em vez de exibir um crédito entregue otimista.

**Premissa padrão: base econômica constante.** O valor financeiro da operação sobe quando IBS/CBS entram por fora — isso é efeito tributário, não comercial. Só há efeito comercial se o consultor informar variação explícita da base negociada.

**Tela de composição 100%.** Em Projeção de cenários → aba **Simulação da cadeia**. O consultor escolhe o lado (compras ou vendas), a dimensão, e vê a composição como barra de 100% — base e cenário lado a lado, com a variação em pontos percentuais. A migração é declarada em três campos: grupo de origem, percentual **do grupo** e grupo de destino, com a equivalência sobre o total calculada na hora. A alteração comercial é um quarto campo, opcional, que sai de zero.

Abaixo, a decomposição do efeito, o crédito por natureza do dado, a memória do grupo e o drill-down até o documento — com a fração de cada lançamento visível.

**Validação.** `node testes/cenarios.test.js` roda 16 testes do núcleo: migração de 0%, 100%, duas saindo do mesmo grupo, precedência individual, faixas do Simples, crédito zero real x indeterminado, cliente conhecido e desconhecido, alteração comercial de ±5%, reconciliação agregado × detalhe e do waterfall.

### Regras de cálculo (tela Configurações)

Todas as regras que o motor usa vivem no banco e são editáveis pela tela **Regras de cálculo** — nenhuma fica escondida no código. Alterar um valor muda o resultado da próxima projeção.

| Aba | O que governa |
|---|---|
| **Alíquotas e transição** | IBS e CBS por ano, fatores de ICMS/ISS, PIS/COFINS e IPI ainda devidos, marcação de "simulação" |
| **Forma de cálculo** | Se cada tributo é por dentro ou por fora, e se sai da base econômica. É a regra mais importante do motor |
| **Regimes e crédito** | Quem credita e quem gera crédito de IBS/CBS, quem recolhe no DAS, alíquota de PIS/COFINS para reconstruir a carga atual |
| **Reduções** | Percentual de cada enquadramento (30%, 60%, alíquota zero, imunidade) |
| **Simples Nacional** | Limites, alíquotas nominais, parcelas a deduzir e repartição por tributo, faixa a faixa |
| **Natureza por CFOP** | Qual natureza cada CFOP indica, com prioridade de avaliação |
| **Limiares e padrões** | Quando um resultado é alto/médio/baixo, tolerância da conferência e alíquotas presumidas |
| **Ensaio de regra** | Simula uma operação e mostra a volta à base passo a passo, com as regras atuais |
| **Histórico** | Toda alteração registrada: quem mudou o quê, de qual valor para qual |

Os arquivos em `src/config/` deixaram de ser a fonte da verdade — passam a ser apenas a semente que popula as tabelas na primeira execução.

**Sobre a prioridade dos CFOPs.** O primeiro dígito indica operação com o exterior e precisa ser avaliado antes dos grupos de três dígitos: 5102 é venda interna e 3102 é importação, mas os três últimos dígitos são iguais. Por isso cada regra tem prioridade — 1 para prefixo do exterior, 2 para grupo, 3 para sentido geral.

### Consulta de regime na base da Receita

Botão **Consultar regime na Receita** em Cadastros e importação. Resolve a lacuna que nem o XML nem o SPED cobrem: descobrir se a contraparte é MEI, optante do Simples ou está no regime regular.

A base pública do CNPJ informa a opção pelo Simples Nacional e pelo SIMEI. **Não** distingue Lucro Real de Presumido — e não precisa: para IBS/CBS o que importa é estar dentro ou fora do Simples. Quem não é optante apura pelo regime regular, credita as entradas e destaca integralmente nas saídas, seja Real ou Presumido.

| Provedor | Chave | Limite | Intervalo adotado |
|---|---|---|---|
| BrasilAPI (padrão) | não exige | por IP | 1,5 s entre consultas |
| CNPJá aberta | não exige | 5 por minuto | 13 s entre consultas |

O resultado é gravado em cache com data e fonte, e revalidado a cada 90 dias (configurável). Reconsultar o mesmo CNPJ não gasta cota. A consulta só toca em quem está sem regime — o que o consultor definiu à mão é preservado, salvo pedido explícito.

Situação cadastral irregular (baixada, inapta, suspensa) é destacada no resultado: projetar crédito sobre operação com fornecedor baixado é risco que o diagnóstico deve apontar.

`BRASILAPI_URL` no `.env` permite apontar para um proxy interno com o mesmo contrato, se a rede não liberar acesso externo.

### Bases anuais da Receita (Lucro Real / Presumido)

Em Bases de classificação → aba **Bases da Receita**. Importa as relações anuais publicadas pela Receita Federal para uma tabela local indexada — depois disso a consulta é instantânea e offline.

**O que elas resolvem, e o que não resolvem.** Distinguir Lucro Real de Presumido **não** altera o crédito de IBS/CBS: os dois apuram pelo regime regular e creditam igual. O que melhora é a reconstrução da carga atual — sem o destaque de PIS/COFINS no documento, o motor estima por 9,25% (Real) ou 3,65% (Presumido), e errar aí distorce a base econômica.

**Precedência das fontes de regime:**

```
1. definição manual do consultor          (sempre vence)
2. Simples/MEI — API da Receita ou XML    (decide o CRÉDITO)
3. bases anuais Real/Presumido            (refina o regime regular)
4. CRT do XML / opSimpNac da NFS-e        (indício)
```

A ordem não é arbitrária: quem é optante do Simples não está nestas bases, e se aparecer em ambas a informação do Simples prevalece, porque é ela que determina o comportamento do crédito.

**Importação por caminho, não por upload.** CSV de dezenas de megabytes por HTTP é frágil e desnecessário quando o sistema roda na mesma máquina. Informe o caminho do arquivo no servidor e o sistema lê em streaming, inserindo em lotes dentro de transação. Medido com volume real: **1,41 milhão de linhas em 39 segundos**, e a consulta depois leva 26 microssegundos.

O leiaute é detectado sozinho — codificação (UTF-8 ou ISO-8859-1), separador, presença de cabeçalho e coluna do CNPJ. O botão **Inspecionar leiaute** mostra o que foi reconhecido antes de importar, para não processar um milhão de linhas errado.

Testado contra o formato real de exportação da Receita (`ano,cnpj,cnpj_da_scp,forma_de_tributacao,quantidade_de_escrituracoes`): o sistema também detecta quando **regime e ano vêm na própria linha**, caso em que ignoram o que foi selecionado na tela — um único arquivo pode misturar Lucro Real e Presumido, e cada CNPJ recebe o que está escrito nele. Sociedade em Conta de Participação (SCP) é reconhecida e contabilizada à parte; linhas com forma de tributação não identificável são ignoradas e contadas, não silenciosamente descartadas.

Aceita CNPJ completo ou raiz de 8 dígitos. Quando a relação traz só a matriz, as filiais herdam o regime — o enquadramento é da pessoa jurídica, não do estabelecimento, e a consulta registra se casou por CNPJ ou por raiz.

As bases **não** vão no `seed.sql`: são milhões de linhas e cada instalação importa as suas.

### Bases de classificação tributária

Duas bases oficiais que dizem em qual tributação cada item se enquadra. São elas que determinam a redução aplicada no cálculo — sem elas, tudo entra como tributação integral.

| Base | Chave | Planilha esperada | O que traz |
|---|---|---|---|
| **Mercadorias** | NCM | `ncms.xlsx`, aba `Detalhamento candidatos` | CST, cClassTrib, anexo da LC 214, fundamento legal e % de redução de IBS/CBS |
| **Serviços** | Item LC 116 + NBS | `correlacao.xlsx`, aba `tabela geral` | cClassTrib, INDOP e local de incidência do IBS |

Suba as duas em **Bases de classificação**. Depois de importar a movimentação, o sistema cruza cada lançamento com as bases e grava a redução correta.

**Sobre os enquadramentos múltiplos.** Um mesmo NCM pode ter mais de um candidato — o NCM 3004.90.99, por exemplo, aparece com quatro classificações possíveis (alíquota zero do Anexo XIV, redução de 60% do Anexo IV, e outras). O sistema **não escolhe por você**: marca o lançamento como pendente e lista os candidatos com anexo, fundamento e percentual para o consultor decidir. A decisão vale para todos os lançamentos daquele NCM naquele cliente e fica registrada.

A chave dos serviços é composta de propósito: a mesma NBS pode ter classificação diferente conforme o item da LC 116. A NBS 1.1405.12.00 é redução de 30% no item 05.01 (profissões intelectuais) e tributação integral nos itens 05.02 e 05.07. Classificar só pela NBS produziria erro.

| **Cadastros e importação** | Sobe clientes e fornecedores (CNPJ, descrição, regime) e a movimentação por planilha. As colunas são reconhecidas pelo nome do cabeçalho — a ordem não importa e acentos/maiúsculas são ignorados. |
| **Perfil tributário** | Carga bruta e líquida, composição de receita e projeção da carga por ano, com leitura técnica do perfil. |
| **Cadeia de fornecedores** | Curva ABC, compras por regime, crédito hoje x crédito no novo modelo, custo efetivo de aquisição e riscos de crédito. |
| **Cadeia de clientes** | Carteira por perfil (quem credita e quem sente o preço cheio), impacto por cliente e riscos comerciais. |
| **Projeção de cenários** | Demonstrativo Receita (−) Impostos (−) Custos = Margem bruta, de 2026 a 2033, com régua de repasse. |
| **Calculadora** | Uma operação isolada: volta da base, IVA por fora, crédito e custo efetivo ano a ano. |

### Módulos 2 a 4

- **Precificação e margem** — margem hoje, margem com preço congelado, preço neutro (o que preserva a margem) e sensibilidade do cliente.
- **Revisão de contratos** — checklist por tipo de contrato, cálculo automático de risco e biblioteca de 10 cláusulas com texto sugerido.
- **Análise de contrato por IA** — sobe o contrato em PDF, imagem ou texto; a IA transcreve, cruza com a base de conhecimento e devolve os achados cláusula a cláusula, com trecho literal do contrato, fundamento citado e cláusula sugerida pronta para inserir. Os achados podem ser aplicados ao checklist e virar ações no plano.
- **Capacitação do time** — trilhas (workshop prático, institucional e trilha técnica fiscal), turmas, participantes e presença.

### Base de conhecimento (RAG)

É de onde a IA tira o fundamento de cada análise. Vem semeada com oito documentos técnicos (IVA Dual, cronograma, split payment, créditos, regimes diferenciados, contratos administrativos, cláusulas e impactos por regime) e aceita novos materiais em texto, PDF ou imagem — pareceres, minutas padrão, notas técnicas, atos normativos.

A recuperação é léxica (BM25), sem serviço de embeddings e sem banco vetorial: roda offline, na rede interna, e é explicável — dá para mostrar ao cliente exatamente de qual trecho veio cada fundamento. Cada análise registra as fontes consultadas.

**Configuração da IA.** Precisa de uma chave da API Anthropic, informada na própria tela ou no arquivo `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

A variável de ambiente tem prioridade sobre a chave salva no banco. Sem chave, todo o resto do sistema funciona normalmente — só a análise por IA e a leitura de PDF/imagem ficam indisponíveis.

**Revisão humana é obrigatória.** A saída da IA é minuta de trabalho: o parecer é do profissional, não da ferramenta.

### Gestão do produto

- **Plano de adequação** — ações, responsáveis, prazos e status.
- **Serviços e combos** — tela de proposta: ao marcar os serviços, o melhor desconto de combo aplicável entra sozinho. O cliente pode contratar qualquer frente separadamente.
- **Preços e combos** — configuração comercial: tabela de preços dos 12 serviços da cartilha (preço, prazo, unidade, entregáveis, recorrência) e montagem dos pacotes, com prévia do valor final enquanto se escolhem os serviços.
- **Integração Questor** — busca cadastros e movimentação pelo nWeb.

## A calculadora: como o cálculo é feito

O ponto central do produto é **voltar a base**. Hoje ICMS, ISS, PIS e COFINS são calculados *por dentro* (integram a própria base); IBS e CBS são *por fora*. Comparar alíquotas nominais engana — só a base limpa permite comparação honesta.

```
Valor total da operação
(-) ICMS  (-) ISS  (-) PIS/COFINS  (-) IPI  (-) ICMS-ST
= VALOR SEM IMPOSTO  ← base econômica do bem/serviço

VALOR SEM IMPOSTO × (1 + alíquota IBS/CBS do ano) + tributos residuais
= PREÇO NO NOVO MODELO

PREÇO (-) créditos aproveitáveis = CUSTO EFETIVO
```

O que muda o resultado:

- **Regime de quem emite** — define os tributos embutidos hoje e se destaca IBS/CBS integral amanhã. Simples/MEI transferem apenas o valor embutido no DAS e continuam recolhendo o DAS durante toda a transição.
- **Regime de quem recebe** — define o crédito. Lucro Real já credita PIS/COFINS hoje; Lucro Presumido não credita e passa a creditar 100%; Simples no DAS não credita.
- **Enquadramento no IVA** — tributação integral, redução de 30% (profissões regulamentadas), 60%, alíquota zero, imunidade ou regime específico com alíquota informada.
- **Grau de repasse** — de 0% (preço congelado, fornecedor absorve) a 100% (repasse integral). É o botão que separa impacto tributário de decisão comercial.

Quando a planilha não traz os impostos, o sistema estima pelo regime e sinaliza isso na importação.

## Parâmetros fiscais

Tudo em `src/config/parametros.js` — cronograma 2026-2033, alíquotas de referência (CBS 8,80% / IBS 17,70%), regimes, reduções e Imposto Seletivo. Alterou ali, mudou o sistema inteiro. **Mantenha atualizado**: as alíquotas de referência ainda serão revisadas por lei ao longo da transição.

Cronograma implementado:

| Ano | CBS | IBS | ICMS/ISS | PIS/COFINS | IPI |
|---|---|---|---|---|---|
| 2026 | 0,9% (compensável) | 0,1% | integral | integral | integral |
| 2027-2028 | 8,7% | 0,1% | integral | extintos | zerado (exceto ZFM) |
| 2029 | 8,8% | 1,77% | 90% | — | — |
| 2030 | 8,8% | 3,54% | 80% | — | — |
| 2031 | 8,8% | 5,31% | 70% | — | — |
| 2032 | 8,8% | 7,08% | 60% | — | — |
| 2033 | 8,8% | 17,7% | extintos | — | — |

## Planilhas de importação

Baixe os modelos direto do sistema (Cadastros e importação → Baixar modelo) ou em:

- `/api/modelos/parceiros` — CNPJ, Descrição, Regime Tributário, UF, Município
- `/api/modelos/movimento_fornecedor` — Nome, InscrFederal, Descrição Produto, NCM, Competência, Valor, Base de Cálculo, ICMS, ICMS ST, IPI, PIS, COFINS, ISS, Redução
- `/api/modelos/movimento_cliente` — mesmas colunas

Regimes aceitos no texto da planilha: Lucro Real, Lucro Presumido, Simples Nacional, Simples Regime Regular, MEI, Produtor Rural PF, Imune/Isento, Pessoa Física, Órgão Público, Exterior. Valores aceitam `1.234,56` ou `1234.56`.

**Importe o cadastro antes da movimentação.** O regime do parceiro é o que determina o crédito; sem ele, o lançamento entra como Lucro Real e o diagnóstico fica otimista. A tela avisa quantos lançamentos ficaram sem vínculo e o botão "Revincular regimes" reprocessa depois de corrigir o cadastro.

## Integração Questor (nWeb)

O nWeb é o serviço HTTP local do Questor Tributário (`nWeb.exe`, porta 8080 por padrão, ajustável pelo parâmetro `/porta` no atalho). Token é opcional e configurado dentro do Questor.

Na tela **Integração Questor**:

1. Informe a URL base (ex.: `http://192.168.0.10:8080`) e o token, se houver.
2. Clique em **Testar conexão** — usa `/TnWebDMDadosGerais/PegarVersaoQuestor` e `/api/TnInfo/Info`, os dois endpoints documentados e estáveis.
3. Preencha o **código da empresa no Questor** no cadastro da empresa.
4. Importe fornecedores, clientes, entradas e saídas pelos botões.

Os endpoints de consulta de dados **variam conforme a versão do Questor e os módulos licenciados**. Por isso o mapa de caminhos, parâmetros e de-para de campos fica editável na própria tela (e em `src/config/questorEndpoints.js`), sem tocar em código. Use a **chamada livre** para descobrir e validar os caminhos da sua instalação antes de gravar o mapa — a documentação oficial está em `docs.questor.com.br` → Integrações → nWeb (API) → Endpoints nWeb.

O parser tolera respostas em formatos diferentes (array direto, `dados`, `data`, `registros`, `itens`) e casa os nomes de campo ignorando acento e caixa.

## Relatórios

Excel com capa identificada, gerado por `/api/empresas/:id/relatorio/:tipo`, onde tipo é `diagnostico`, `fornecedores`, `clientes`, `precificacao`, `contratos` ou `plano`. Nome do arquivo no padrão `CNPJ - RAZÃO SOCIAL - tipo.xlsx`.

## Estrutura

```
server.js                     servidor Express
src/
  config/parametros.js        cronograma, alíquotas, regimes, reduções
  config/conteudo.js          biblioteca de cláusulas e trilhas de capacitação
  config/questorEndpoints.js  mapa padrão do nWeb
  db.js                       schema SQLite + seed do catálogo de serviços
  engine/calculadora.js       volta da base, IVA por fora, créditos
  engine/precificacao.js      margem, preço neutro, sensibilidade do cliente
  engine/cadeia.js            curva ABC, riscos, cenários agregados
  services/importador.js      leitura de planilhas e modelos
  services/basesReforma.js    bases de NCM e LC116/NBS, classificação e decisões
  services/importadorXml.js   parser de NF-e, NFC-e, CT-e e NFS-e
  services/importadorSped.js  parser de EFD ICMS/IPI e EFD Contribuições
  services/mapaRiscos.js      mapa de riscos derivado dos resultados do motor
  services/regras.js          repositório central das regras de cálculo
  services/cnpjReceita.js     consulta de regime na base pública do CNPJ
  services/baseRegimeReceita.js  importação das relações anuais Real/Presumido
  services/dimensoes.js       partições e visões da cadeia econômica
  services/cenarioMotor.js    premissas, expansão proporcional e recálculo
  services/cenarioMemoria.js  memória do grupo, drill-down e reconciliação
  services/motorExec.js       execução do motor e consolidação por fornecedor/cliente
  engine/reconstrucao.js      voltar à base econômica + alíquota efetiva do Simples
  engine/classificador.js     CST IBS/CBS e cClassTrib pela operação concreta
  engine/motor.js             projeção IBS/CBS, créditos, cenários e apuração
  config/tabelasSimples.js    anexos e faixas do Simples Nacional
  services/rag.js             base de conhecimento e recuperação BM25
  services/ia.js              leitura de PDF/imagem e análise de contratos
  services/questor.js         cliente nWeb
  services/relatorio.js       Excel
  routes/api.js               API REST
public/                       interface (sem build, sem dependência externa)
dados/                        banco SQLite (criado na primeira execução)
```

Nenhuma dependência de CDN: o sistema funciona em rede interna sem internet.

## Backup

Copie a pasta `dados/` com o serviço parado (ou use `VACUUM INTO`). É um arquivo SQLite único, mais os arquivos `-wal` e `-shm`.

# Guia do Instrutor — Sattva Reforma Tributária

Este roteiro ensina como conduzir usuários na operação do sistema. Demonstre sempre a empresa correta e deixe claro que dados ausentes permanecem **INDETERMINADOS** ou **INCOMPLETOS**; não devem ser tratados como zero.

## Preparação geral

- Confirme que o participante possui acesso e uma empresa selecionada.
- Use uma empresa de treinamento ou dados autorizados; não altere dados reais durante demonstrações sem autorização.
- Abra o menu e mantenha a **Central de Dados** como referência para cadastro, importação, correção e revisão. O material de apoio pode ser consultado ou baixado em **Gestão do produto → Manuais do sistema**.
- Explique a sequência operacional: **Central de Dados → tratamento e validações → módulos → relatórios**.

---

## Módulo 1 — Primeiros passos e Central de Dados

### Objetivo

Fazer o aluno entrar, selecionar a empresa, localizar o projeto, registrar dados e identificar pendências.

### Público-alvo e duração sugerida

Consultores, usuários de implantação e responsáveis do cliente. Duração: 60 a 75 minutos.

### Antes do treinamento

Tenha uma empresa de treinamento, uma planilha de parceiros/movimentos autorizada e, se possível, arquivos XML ou SPED de exemplo.

### Telas a abrir

**Entrar**, **Dados → Empresas e estabelecimentos**, **Gestão do produto → Escopo e entregas** e **Dados → Central de Dados**.

### Passo a passo da demonstração

1. Mostre os campos E-mail, Senha e o botão **Entrar**.
2. Em Empresas atendidas, mostre **Cadastrar empresa**, **Editar** e **Abrir projeto**.
3. Mostre Escopo e entregas: aprovação, responsáveis, checklist, progresso, pendência e próxima ação.
4. Abra a Central de Dados e apresente as abas **Fornecedores**, **Clientes**, **Planilhas** e **XML, SPED e motor**.
5. Demonstre onde ficam Dados complementares, Importações e documentos, Tratamento e revisão e Lotes importados.
6. Mostre que PGDAS está identificado como `NAO_SUPORTADO_ATUALMENTE` para importação própria.

### Exercício do aluno

Selecionar uma empresa, localizar o checklist do projeto, encontrar a próxima ação e navegar até a Central de Dados. O aluno deve apontar onde importaria uma planilha, XML, SPED e apuração PIS/Cofins.

### O que o instrutor deve conferir

O aluno sabe diferenciar Dados de módulos analíticos e consegue localizar o cadastro de clientes/fornecedores.

### Erros comuns

- Tentar importar dados pelo módulo de análise.
- Trabalhar na empresa errada.
- Interpretar contador zero como ausência comprovada sem verificar a Central e pendências.

### Perguntas de validação

- Onde você registra uma margem operacional?
- Onde você confere um lote importado?
- O que fazer ao encontrar uma possível duplicidade?

### Checklist de conclusão

- [ ] Empresa selecionada.
- [ ] Central de Dados localizada.
- [ ] Checklist e próxima ação localizados.
- [ ] Participante entende que dado ausente não é zero.

---

## Módulo 2 — Perfil, Raio-X e Diagnóstico

### Objetivo

Ensinar a ler o retrato tributário, o histórico e as análises de fornecedores/clientes sem confundir informação histórica com projeção.

### Público-alvo e duração sugerida

Consultores fiscais, controladoria e responsáveis pela análise. Duração: 75 minutos.

### Antes do treinamento

Empresa com dados carregados ou ambiente de demonstração. Abra a Central de Dados previamente para mostrar a origem dos dados.

### Telas a abrir

**Perfil Tributário**, **Cadeia de fornecedores**, **Cadeia de clientes**, **Impacto Final CBS**, **Cobertura do diagnóstico** e, quando aplicável, **Bases de classificação**.

### Passo a passo da demonstração

1. Em Perfil Tributário, apresente regime, períodos, folha e margem.
2. Leia o **Raio-X histórico — situação anterior × CBS**; destaque que PIS/Cofins e PGDAS aparecem somente quando disponíveis.
3. Mostre Apurações Históricas de PIS/Cofins: **Revisar**, confiança, origem, pendências e **Confirmar dados**.
4. Abra a Cadeia de fornecedores e explique valor, regime, compra projetada e crédito potencial.
5. Abra a Cadeia de clientes e explique vendas, impacto e referências fiscais. Use **Corrigir na Central de Dados** se houver pendência.
6. Mostre Impacto Final CBS como consolidação, não como cálculo alternativo.

### Exercício do aluno

Identificar um período com informação incompleta, indicar a pendência e apontar qual seção da Central de Dados pode ajudar a completá-la.

### O que o instrutor deve conferir

O aluno distingue `REAL`, `CALCULADO`, `SIMULADO`, `INDETERMINADO` e `INCOMPLETO` e não toma uma conclusão a partir de campo ausente.

### Erros comuns

- Interpretar crédito potencial como crédito automaticamente aproveitável.
- Corrigir uma pendência diretamente em uma cadeia em vez de usar a Central.
- Confundir CBS do motor com informação histórica anterior.

### Perguntas de validação

- Onde você revisa a origem de uma apuração PIS/Cofins?
- O que significa uma competência INDETERMINADA?
- Qual é a ação correta quando falta referência de venda por serviço?

### Checklist de conclusão

- [ ] Perfil e Raio-X lidos.
- [ ] Cadeias de clientes e fornecedores abertas.
- [ ] Pendência encaminhada à Central.

---

## Módulo 3 — Cenários e Comparador de Regimes

### Objetivo

Ensinar como usar simulações e comparar cenários sem declarar um vencedor quando os dados são insuficientes.

### Público-alvo e duração sugerida

Gestores, planejamento tributário e controladoria. Duração: 60 minutos.

### Antes do treinamento

Use uma empresa/fixture com dados suficientes para ao menos dois cenários comparáveis. Não use dados reais incompletos para demonstrar ranking como se fosse conclusão.

### Telas a abrir

**Módulo 1 · Diagnóstico → Projeção de cenários** e **Perfil Tributário → Comparador de regimes tributários**.

### Passo a passo da demonstração

1. Abra Projeção de cenários e mostre as premissas que a tela permite alterar.
2. Execute uma simulação e destaque o rótulo **SIMULADO**.
3. Abra o Comparador e apresente Lucro Real, Lucro Presumido, Simples Nacional e Simples Nacional Híbrido.
4. Mostre tributos estimados, carga efetiva, diferença, premissas e pendências.
5. Explique que **Melhor cenário estimado** só aparece quando há ao menos dois cenários comparáveis.
6. Mostre uma situação de dados insuficientes e encaminhe para folha, margem, receitas e composição na Central.

### Exercício do aluno

Ler dois cenários comparáveis, indicar qual premissa torna cada resultado simulado e apontar por que um cenário incompleto não pode vencer o ranking.

### O que o instrutor deve conferir

O aluno não trata margem informada como lucro fiscal real e não conclui vencedor com pendências abertas.

### Erros comuns

- Usar Simples Nacional Híbrido como regime cadastral real.
- Ignorar base temporal ou receita diferente entre cenários.
- Considerar INCOMPLETO como carga zero.

### Perguntas de validação

- Quando o ranking não deve ser exibido?
- Onde informar margem operacional?
- Como identificar que um resultado é simulado?

### Checklist de conclusão

- [ ] Cenário aberto e interpretado.
- [ ] Comparador lido.
- [ ] Dados insuficientes reconhecidos e encaminhados.

---

## Módulo 4 — Precificação, Contratos e Acompanhamento

### Objetivo

Capacitar o usuário a transformar resultados em decisões comerciais, contratuais e de acompanhamento.

### Público-alvo e duração sugerida

Comercial, jurídico, controladoria e gestores de projeto. Duração: 75 minutos.

### Antes do treinamento

Confirme uma empresa com saídas oficiais e, para precificação, formação de custo disponível.

### Telas a abrir

**Precificação e margem**, **Base de formação de custo**, **Revisão de contratos**, **Análise de contrato (IA)**, **Baseline e realizado** e **Escopo e entregas**.

### Passo a passo da demonstração

1. Em Precificação, leia preço atual, CBS, custo líquido, margem atual/projetada e status.
2. Abra formação de custo quando algum item estiver incompleto ou divergente.
3. Em Contratos, mostre **Cadastrar contrato**, carteira, risco, vigência e status.
4. Explique que `INTERPRETADO` é leitura orientada e `SUGERIDO` exige avaliação humana.
5. Em Escopo e entregas, mostre atualização de tarefa, responsável, prazo, evidência e pendência do cliente.
6. Em Acompanhamento, leia baseline e realizado no período exibido.

### Exercício do aluno

Encontrar um item de precificação incompleto, identificar a informação necessária e criar/atualizar uma tarefa de acompanhamento para a pendência.

### O que o instrutor deve conferir

O aluno encaminha lacunas de dado à Central e não altera resultados fiscais como forma de correção comercial.

### Erros comuns

- Tratar sugestão contratual como texto definitivo.
- Alterar margem sem registrar premissa.
- Fechar tarefa sem evidência ou observação.

### Perguntas de validação

- Onde registrar uma pendência do cliente?
- O que representa um item DIVERGENTE de precificação?
- Quem deve revisar um item SUGERIDO?

### Checklist de conclusão

- [ ] Precificação lida.
- [ ] Contrato e risco localizados.
- [ ] Tarefa e responsável atualizados.

---

## Módulo 5 — Relatórios, Capacitação e Encerramento

### Objetivo

Ensinar a preparar entregáveis, conduzir capacitação e encerrar o trabalho com rastreabilidade.

### Público-alvo e duração sugerida

Gestores de conta, consultores e instrutores. Duração: 45 a 60 minutos.

### Antes do treinamento

Empresa selecionada, escopo aprovado e, quando aplicável, trilha de capacitação liberada.

### Telas a abrir

Painel do projeto, **Capacitação do time**, **Escopo e entregas**, **Acompanhamento geral** e relatórios acessíveis pelos botões do Painel/módulos.

### Passo a passo da demonstração

1. No Painel, mostre **Relatório técnico**, **Mapa de riscos** e **Relatório completo**.
2. Confirme empresa, período/escopo e estados de dados antes de compartilhar qualquer relatório.
3. Em Capacitação, use **Programar turma** quando a trilha estiver liberada e abra **Participantes** para registrar lista/presença.
4. Em Escopo e entregas, confira checklist, evidências, tarefas e acompanhamentos.
5. Mostre como identificar entregas concluídas, não aplicáveis e pendências bloqueantes.

### Exercício do aluno

Preparar uma checagem de encerramento: localizar relatório, revisar checklist, apontar uma pendência e identificar a próxima ação.

### O que o instrutor deve conferir

O aluno confirma empresa selecionada, lê estados dos dados e não afirma que uma exportação está homologada sem conferir o arquivo no ambiente.

### Erros comuns

- Compartilhar relatório da empresa errada.
- Considerar pendência como concluída por falta de dado.
- Programar capacitação sem trilha liberada no plano.

### Perguntas de validação

- Quais verificações antecedem o encerramento?
- Onde estão as evidências de implantação?
- O que fazer com uma entrega `COM_PENDENCIA`?

### Checklist de conclusão

- [ ] Relatórios localizados e conferidos.
- [ ] Turma/participantes verificados quando aplicável.
- [ ] Checklist revisado.
- [ ] Pendências e próxima ação registradas.

## Encerramento do treinamento

Peça que cada participante execute uma rota completa: selecionar empresa → abrir Central de Dados → identificar uma pendência → abrir o módulo impactado → explicar o estado do dado → registrar a próxima ação. Considere o treinamento concluído quando a pessoa consegue distinguir entrada de dados, tratamento, análise e acompanhamento sem auxílio técnico.

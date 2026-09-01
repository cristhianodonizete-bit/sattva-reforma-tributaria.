# Manual do Usuário — Sattva Reforma Tributária

Este manual ensina a operar o sistema. Use a **Central de Dados** para cadastrar, importar, complementar e corrigir informações; os módulos de análise usam esses mesmos dados.

## 1. Primeiro acesso e navegação

**Para que serve.** Entrar no ambiente e confirmar a empresa em uso.

**Onde acessar.** Tela inicial → informe **E-mail** e **Senha** → **Entrar**. Se necessário, use **Esqueci minha senha**.

**O que conferir.** Após o acesso, confira o nome da empresa no Painel do projeto. Para trocar, abra **Dados → Empresas e estabelecimentos**, localize a empresa e clique em **Abrir projeto**.

**Navegação.** O menu separa **Dados** (Central de Dados, Empresas e estabelecimentos, Cadastros compartilhados e Bases, catálogos e classificações) dos módulos: **Módulo 1 · Diagnóstico**, **Precificação**, **Contratos**, **Capacitação** e **Acompanhamento**. A área **Gestão do produto → Escopo e entregas** reúne o projeto e o checklist. Em **Gestão do produto → Manuais do sistema**, consulte ou baixe este manual e o Guia do Instrutor sempre na versão publicada mais recente.

**Concluído quando.** O Painel exibe a empresa correta. A próxima ação é abrir a Central de Dados ou o módulo previsto no escopo.

## 2. Cadastro de empresa / cliente

**Para que serve.** Criar a empresa que receberá os dados e as análises.

**Onde acessar.** **Dados → Empresas e estabelecimentos → Cadastrar empresa**.

**O que preencher.** Razão social, CNPJ, regime tributário, enquadramento predominante no IVA, UF, município, CNAE principal, faturamento anual, código Questor (se houver), nome fantasia e atividade. Preencha ao menos os campos marcados pela tela como obrigatórios.

**O que clicar e conferir.** Clique em **Cadastrar empresa** e confirme a mensagem de sucesso. A empresa deve aparecer em **Carteira de projetos**; use **Editar** para corrigir e **Abrir projeto** para selecioná-la.

**Se houver erro.** Revise CNPJ, campos obrigatórios e formato de valores. Não exclua uma empresa com dados reais para corrigir um campo; use **Editar**.

**Observação.** Estabelecimentos não possuem cadastro operacional separado nesta versão: `NAO_SUPORTADO_ATUALMENTE`.

## 3. Criação e gestão do projeto

**Para que serve.** Definir o escopo contratado, responsáveis, entregas e checklist.

**Onde acessar.** **Gestão do produto → Escopo e entregas**.

**Antes de começar.** A empresa deve estar cadastrada e a proposta/contratação deve estar disponível.

**Passo a passo.**

1. Em **Escopos aguardando aprovação**, localize o cliente e clique em **Fechar e aprovar**.
2. Informe meses de acompanhamento e observações; confirme a aprovação.
3. No projeto aprovado, use **Alterar escopo** para incluir ou retirar serviços autorizados.
4. Use **Planejar** em cada entrega para registrar responsável Sattva, responsável do cliente, contatos, tarefas e prazos.
5. Atualize os itens do checklist em **Atualizar**; informe situação, evidência/vínculo e observações.

**Escopos.** Os escopos iniciais são Diagnóstico, Contratos, Precificação, Capacitação e Acompanhamento. Cada um pode gerar entregas e checklist próprios.

**O que conferir.** Percentual de progresso, entregas concluídas, pendências de implantação e **próxima ação**. `VALIDADO`, `CONCLUIDO` e `NAO_APLICAVEL` sinalizam item concluído; `AGUARDANDO_CLIENTE` e `COM_PENDENCIA` exigem acompanhamento.

**Próxima ação.** Solicite ou registre a evidência indicada no checklist, preferencialmente pela Central de Dados.

## 4. Central de Dados

**Para que serve.** É o ponto principal para entrada e tratamento de dados:

`Central de Dados → tratamento e validações → módulos do produto → relatórios e entregáveis`.

**Onde acessar.** **Dados → Central de Dados**.

**O que encontrar.**

- **Planilhas:** cadastro e movimentação de fornecedores/clientes.
- **XML, SPED e motor:** envio de XML fiscal e SPED; o motor é acionado somente quando o usuário escolher essa ação.
- **Importações e documentos:** atalhos para XML/SPED, planilhas, apuração PIS/Cofins e referências de serviços.
- **Dados complementares:** folha, margem operacional e receitas sem DF-e.
- **Tratamento e revisão:** apurações, rastreabilidade, pendências de regime e pendências de classificação.
- **Lotes importados:** histórico de arquivos e registros.

**Como voltar.** Após concluir a entrada ou correção, use o menu para abrir Perfil Tributário, Diagnóstico, Cadeias, Cenários ou outro módulo. Eles consomem a mesma base já tratada.

## 5. Cadastros na Central de Dados

### Clientes e fornecedores

**Para que serve.** Vincular parceiro, CNPJ/CPF, regime e dados de localização às operações.

**Onde acessar.** **Central de Dados → Fornecedores** ou **Clientes**.

**O que fazer.** Use **Incluir manualmente** ou envie uma planilha. Preencha CNPJ/CPF, descrição, regime tributário, UF e município quando disponíveis. Use **Editar** para ajustar um parceiro já criado.

**O que conferir.** A linha aparece em **Fornecedores cadastrados** ou **Clientes cadastrados** com regime e origem. Para pendências de regime, use **Ver pendências de regime** e, quando aplicável, **Consultar regime na Receita**.

### Referências fiscais de vendas por serviço

**Para que serve.** Registrar a referência tributária de serviços de venda quando o documento não trouxer o dado necessário.

**Onde acessar.** **Central de Dados → Clientes → Referências fiscais das vendas por serviço**.

**O que preencher.** Descrição do serviço, NBS quando houver, PIS/COFINS da venda, DAS efetivo e ISS somente quando conhecidos. Use **Adicionar serviço ao cadastro**, **Importar referências** ou **Definir referência**.

**Pendência.** Se a tabela sinalizar referência obrigatória, complete a informação antes de usar estimativas na análise.

### Outros cadastros

Produtos, serviços mestre, estabelecimentos e classificações não possuem telas independentes de cadastro nesta versão. Use os dados identificados nos documentos, planilhas e referências fiscais de serviço. `NAO_SUPORTADO_ATUALMENTE` como cadastros operacionais separados.

## 6. Importação de XML

**Para que serve.** Usar documentos fiscais como fonte das operações.

**Onde acessar.** **Central de Dados → aba XML, SPED e motor → Importar XML fiscal**.

**Antes de começar.** Selecione a empresa correta e tenha os arquivos XML do período.

**Passo a passo.** Clique ou solte os arquivos na área **Solte os XMLs aqui**. Aguarde a leitura e confira documentos lidos, itens, entradas, saídas, regimes sugeridos e avisos.

**Se houver pendência.** Confira se o documento pertence à empresa selecionada e se os avisos indicam classificação ou identificação a validar. Corrija dados pela Central, não no módulo de análise.

**Concluído quando.** Os lotes aparecem em **XMLs já importados** e os dados ficam disponíveis para tratamento e análise.

## 7. Importação de SPED

**Para que serve.** Carregar arquivos EFD ICMS/IPI ou EFD Contribuições quando disponíveis.

**Onde acessar.** **Central de Dados → aba XML, SPED e motor → Importar SPED**.

**O que fazer.** Clique ou solte arquivos `.txt` ou `.SPED` na área correspondente. Confira itens, participantes, produtos, entradas, saídas, períodos e avisos retornados.

**Se o arquivo não for aceito.** Confirme o tipo de arquivo e o período. Corrija o arquivo de origem e envie novamente; não substitua dado ausente por zero.

**Concluído quando.** O processamento mostra os períodos reconhecidos e o lote aparece no histórico.

## 8. Importação de planilhas

**Para que serve.** Carregar cadastro de parceiros, movimentações e referências fiscais de serviços.

**Onde acessar.** **Central de Dados → aba Planilhas**.

**Antes de começar.** Baixe o modelo disponível em **Baixar modelo** quando houver. São aceitos `.xlsx`, `.xls` e `.csv`.

**Passo a passo.** Escolha Fornecedores ou Clientes, envie a planilha no cartão de cadastro ou movimentação e confira **Importação concluída**, importados, ignorados e colunas reconhecidas.

**Se houver campo não reconhecido.** Compare as colunas reconhecidas com a planilha, corrija cabeçalhos ou conteúdo e envie novamente. Use **Revincular regimes** após importar parceiros ou movimentações que precisem de vínculo.

## 9. Documentos de apuração PIS/Cofins

**Para que serve.** Registrar apurações históricas para revisão e, quando suficientes, exibição no Raio-X.

**Onde acessar.** **Central de Dados → Importações e documentos → Enviar apuração PIS/Cofins**.

**O que fazer.** Selecione o arquivo, escolha PDF, XLSX, CSV ou Relatório ERP e clique em **Enviar e processar**. Em seguida, abra **Perfil Tributário** para revisar o documento listado em **Apurações Históricas de PIS/Cofins**.

**O que conferir.** Use **Revisar** para ver campo, valor, confiança, origem/localização e validação. Campos não identificados aparecem como **Não identificado**, nunca como zero. Baixa confiança e pendências exigem atenção humana.

**Como concluir.** Clique em **Confirmar dados** somente depois da revisão. Em erro, use **Reprocessar** com o arquivo original.

**Reflexo.** Com dados suficientes, a informação pode aparecer no Raio-X Histórico. Se faltar informação, o resultado permanece indeterminado.

## 10. PGDAS

### Para que serve

Registrar a apuração do DAS por competência para empresas do Simples Nacional. Esses dados podem aparecer no Raio-X Histórico e apoiar o Comparador de Regimes.

### Onde acessar

**Central de Dados → Importações e documentos → Importar PGDAS**.

### Antes de começar

Selecione uma empresa enquadrada no **Simples Nacional** e tenha a exportação do PGDAS em formato **XLSX, XLS ou CSV**. O arquivo deve conter, no mínimo, as colunas **Competência** (ou Período) e **DAS** (ou Valor DAS). Receita Bruta, PIS e Cofins são opcionais.

### Passo a passo

1. Selecione a empresa do Simples Nacional.
2. Abra a Central de Dados.
3. Clique em **Importar PGDAS**.
4. Escolha ou solte o arquivo na área indicada.
5. Aguarde a mensagem de competências importadas ou atualizadas.

### O que conferir

Confira se a competência e o valor do DAS foram reconhecidos. Campos que não estiverem no arquivo permanecem sem identificação; eles não são substituídos por zero.

### Se houver pendência ou erro

Baixe o modelo pelo botão **Baixar modelo**, ajuste os cabeçalhos ou complete Competência e DAS nas linhas rejeitadas. Reenvie o arquivo depois da correção.

### Como saber que terminou

O sistema informa a quantidade de competências importadas ou atualizadas e os dados ficam disponíveis nas análises históricas da empresa.

### Próxima ação

Abra o **Raio-X Histórico** para conferir o período importado ou siga para o **Comparador de Regimes** quando os demais dados da empresa estiverem completos.

## 11. Folha de pagamento

**Onde acessar.** **Central de Dados → Fornecedores → Dados complementares → Informar folha**.

**O que preencher.** Competência (AAAA-MM), valor da folha, pró-labore se informado e referência de arquivo opcional.

**O que conferir.** O cartão mostra o total de **Folhas informadas**. Se faltar informação em um período, ele continuará indicado como indisponível no Perfil Tributário.

## 12. Margem operacional

**Onde acessar.** **Central de Dados → Dados complementares → Informar margem operacional**.

**O que preencher.** Período inicial, período final e margem percentual.

**Importante.** A margem operacional é uma **premissa informada** para simulações; não é automaticamente o lucro fiscal real.

**Concluído quando.** A margem aparece no contador da Central e como premissa informada no Perfil Tributário quando aplicável.

## 13. Receitas sem documento fiscal eletrônico

**Onde acessar.** **Central de Dados → Dados complementares → Adicionar receita sem DF-e**.

**O que preencher.** Competência, tipo de receita, descrição, valor e evidência/referência quando houver.

**O que conferir.** Se houver indício de repetição, o sistema marca **POSSIVEL_DUPLICIDADE** e não consolida automaticamente. Revise a evidência antes de usar a receita em análises.

## 14. Tratamento de dados

**Onde acessar.** **Central de Dados → Tratamento e revisão de dados**.

**Como agir.**

- **Pendência de regime:** abra o cadastro, revise CNPJ/CPF e regime; use a consulta disponível somente quando apropriado.
- **Classificação pendente:** abra Clientes → Referências fiscais das vendas por serviço e complete a referência exigida.
- **Apuração com baixa confiança:** abra **Revisar**, confira origem e localização e confirme apenas valores adequados.
- **Possível duplicidade:** confira documento/evidência antes de considerar a receita.
- **Dado incompleto:** complete a fonte disponível ou mantenha o estado indeterminado.

**Regra prática.** Dado ausente não significa zero.

## 15. Estados dos dados

| Estado | O que significa | Ação do usuário |
|---|---|---|
| REAL | Informação registrada em fonte disponível. | Confira origem quando necessário. |
| CALCULADO | Resultado obtido a partir de dados e regras disponíveis. | Leia as premissas e a memória exibida. |
| SIMULADO | Resultado de cenário ou premissa. | Não confunda com histórico real; ajuste premissas se necessário. |
| INTERPRETADO | Leitura orientada de conteúdo, como contrato. | Revise antes de decidir. |
| SUGERIDO | Recomendação que exige avaliação. | Confirme ou ajuste a ação proposta. |
| INDETERMINADO | Não há informação suficiente. | Complete dados pela Central quando possível. |
| INCOMPLETO | Faltam elementos para concluir uma análise. | Leia a pendência e informe o dado solicitado. |

## 16. Perfil Tributário e Raio-X Histórico

**Onde acessar.** **Módulo 1 · Diagnóstico → Perfil Tributário**.

**O que conferir.** Regime atual, períodos analisados, folha, margem, tabela **Raio-X histórico — situação anterior × CBS**, composição das receitas e tratamentos identificados.

**Comparação anterior × CBS.** A coluna **CBS do motor** mostra a fotografia já calculada. PIS/Cofins, PGDAS e créditos históricos só aparecem quando há evidência; `INDETERMINADO` indica falta de informação.

**Próxima ação.** Use **Central de Dados** ou **Completar informações** para corrigir lacunas.

## 17. Diagnóstico e cadeias

**Onde acessar.** Em **Dados → Bases, catálogos e classificações**, consulte as bases importadas, o catálogo fiscal de NCM/NBS, as Bases da Receita (Real/Presumido), classificações e conformidade. Em **Módulo 1 · Diagnóstico**, acesse Cobertura do diagnóstico, Cadeia de fornecedores, Cadeia de clientes, Impacto Final CBS e Projeção de cenários.

**O que conferir.** Resultados principais, origem da base econômica, débitos, créditos, tratamento, classificações e itens a validar. Use a rastreabilidade disponível para entender a origem, sem alterar o documento histórico.

**Fornecedores.** Veja regime, valor, compra projetada, crédito potencial e pendências. Dados faltantes devem ser tratados pela Central.

**Clientes.** Veja perfil, vendas, impacto comercial e referências fiscais de serviços. Quando aparecer **Corrigir na Central de Dados**, use o atalho para preencher a referência necessária.

## 18. Cenários

**Onde acessar.** **Módulo 1 · Diagnóstico → Projeção de cenários**.

**O que fazer.** Escolha as opções e premissas disponíveis na tela, execute a simulação e compare os resultados apresentados.

**O que conferir.** Cenários são identificados como simulados e não alteram os dados históricos reais. Se não houver ação de salvar ou excluir para o tipo de cenário exibido, ele é apenas uma análise da sessão atual: `NAO_SUPORTADO_ATUALMENTE` como histórico de cenários salvo.

## 19. Comparador de Regimes

**Onde acessar.** **Perfil Tributário → Comparador de regimes tributários**.

**O que mostra.** Lucro Real, Lucro Presumido, Simples Nacional e **Simples Nacional Híbrido**, com tributos estimados, carga efetiva, diferença para o menor cenário, status, premissas e pendências.

**Como interpretar.** Só há **Melhor cenário estimado** quando ao menos dois cenários são comparáveis. Cenário `INCOMPLETO` ou `INDETERMINADO` não vence ranking.

**Se faltar dado.** Complete receita por competência, composição/natureza das receitas e margem operacional quando a tela indicar essas pendências.

## 20. Precificação

**Onde acessar.** **Módulo 2 · Precificação → Precificação e margem**.

**O que fazer.** Consulte a precificação oficial por item. Use **Base independente** ou **Gerenciar formação de custo** para registrar as informações comerciais disponíveis.

**O que conferir.** Preço atual, base econômica, CBS, custo líquido, margem atual e projetada. Itens `INCOMPLETO` ou `DIVERGENTE` exigem completar a formação de custo, não estimar informação ausente.

## 21. Contratos

**Onde acessar.** **Módulo 3 · Contratos → Revisão de contratos**.

**O que fazer.** Use **Cadastrar contrato**, informe contraparte, objeto, valor, vigência e demais campos solicitados. Abra **Documento** para anexar ou revisar conteúdo quando disponível.

**Como interpretar.** `INTERPRETADO` indica leitura orientada; `SUGERIDO` indica recomendação para revisão humana. Revise risco, cláusulas e pendências antes de registrar uma ação.

## 22. Acompanhamento e capacitação

**Acompanhamento.** Acesse **Módulo 5 · Acompanhamento → Baseline e realizado** ou **Escopo e entregas**. Atualize responsável, situação, prazo, observações e evidências nas ações disponíveis.

**Capacitação.** Acesse **Módulo 4 · Capacitação → Capacitação do time**. Se a trilha estiver liberada no plano, clique em **Programar turma**, informe agenda e use **Participantes** para registrar nome, e-mail, cargo/área quando solicitados e presença.

**Concluído quando.** Turma, participantes e presença aparecem na agenda com o status correspondente.

## 23. Relatórios e encerramento

**Onde acessar.** No Painel do projeto, use **Relatório técnico**, **Mapa de riscos** ou **Relatório completo**. Outros módulos podem disponibilizar **Exportar Excel**.

**O que conferir.** Empresa selecionada, período/escopo exibido, estados de dados e pendências. Download visual e todos os formatos de exportação não possuem homologação universal: confirme o resultado no seu ambiente antes de distribuir.

**Como encerrar um projeto.** Em **Escopo e entregas**, revise checklist, evidências, tarefas abertas, responsáveis, relatórios e capacitação. O trabalho está pronto para encerramento quando não houver pendência bloqueante e as entregas contratadas estiverem concluídas ou marcadas como não aplicáveis.

## 24. Pendências e erros comuns

| Situação | O que significa | O que fazer |
|---|---|---|
| Dado incompleto | Falta informação necessária. | Complete na Central de Dados. |
| Classificação pendente | Serviço ou item precisa de referência. | Use Clientes → Referências fiscais das vendas por serviço. |
| Possível duplicidade | A receita pode estar em outra fonte. | Compare documentos e evidência antes de usar. |
| Documento não processado | O arquivo não foi aceito ou terminou com erro. | Confira tipo, período e arquivo original; envie novamente. |
| Cenário sem dados suficientes | Não há base para comparação confiável. | Complete as pendências mostradas. |
| Ranking indisponível | Menos de dois cenários são comparáveis. | Revise os dados do Perfil/Comparador. |
| Receita sem natureza | Não foi possível definir composição. | Complete a origem ou mantenha indeterminado. |
| Margem não informada | Premissa de simulação ausente. | Informe em Dados complementares, se aplicável. |
| Período sem informação | Não há dado registrado para a competência. | Importe ou registre a fonte disponível. |

# Conector Sattva–Questor

Serviço local, somente leitura, para nWeb. Ele não abre porta de rede e não aceita comandos livres.

1. Instale Node.js 22 ou superior.
2. Copie `config.example.json` para `config.json` e preencha os dados de pareamento.
3. Execute `configurar-e-iniciar.cmd` na primeira vez. Se precisar trocar o pareamento, execute-o novamente e escolha **S** para substituir as credenciais salvas. Para iniciar sem alterar nada, use `iniciar-conector.cmd`.

Operações permitidas: teste do nWeb, leitura dos parâmetros de relatórios, apuração PIS/Cofins, cancelamentos e a Conferência de Saídas (`nFisRRResumoConfLctoFisSai`). O token fica somente neste computador.

A Conferência de Saídas registra o CFOP contábil do Questor como CFOP efetivo na Sattva, sem substituir o CFOP original do XML. Os parâmetros obrigatórios do relatório são enviados pelo conector conforme o metadado do Questor. Não é necessário gerar novo pareamento: basta substituir os arquivos do pacote e reiniciar o conector.

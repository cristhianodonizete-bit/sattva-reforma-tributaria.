/**
 * MAPA DE ENDPOINTS DO nWeb (Questor)
 * ---------------------------------------------------------------------------
 * O nWeb é o serviço HTTP local do Questor (porta padrão 8080, configurável
 * pelo parâmetro /porta no atalho do nWeb.exe). A autenticação por token é
 * opcional e, quando habilitada no Questor, deve ser enviada em toda requisição.
 *
 * IMPORTANTE — LEIA ANTES DE USAR:
 * Os endpoints de TESTE abaixo são os documentados pela Questor e funcionam em
 * qualquer instalação. Já os endpoints de CONSULTA de dados variam conforme a
 * versão do Questor Tributário e os módulos licenciados. Por isso eles ficam
 * aqui, editáveis, e também pela tela "Integração Questor" do sistema — sem
 * precisar mexer no código.
 *
 * Para descobrir os endpoints da sua instalação:
 *   1. Suba o nWeb.exe com o parâmetro /log
 *   2. Acesse a documentação da Questor: docs.questor.com.br > Integrações >
 *      Gestão Contábil Integração Online (API) > nWeb (API) > Endpoints nWeb
 *   3. Ajuste os caminhos abaixo (ou pela tela) e use o botão "Testar".
 *
 * O sistema também aceita chamada genérica (passthrough): qualquer caminho
 * pode ser chamado por POST /api/questor/raw sem alterar este arquivo.
 */
module.exports = {
  // --- Diagnóstico da conexão (documentados e estáveis) ---
  versao: { metodo: 'GET', path: '/TnWebDMDadosGerais/PegarVersaoQuestor' },
  info: { metodo: 'GET', path: '/api/TnInfo/Info' },

  // --- Consultas de dados (ajustar conforme a instalação) ---
  empresas: { metodo: 'GET', path: '/TnWebDMDadosGerais/PegarEmpresas',
              mapa: { cnpj: 'CNPJ', razao_social: 'RazaoSocial', codigo_questor: 'CodigoEmpresa', regime: 'RegimeTributario', uf: 'UF', municipio: 'Municipio', cnae: 'CNAE' } },

  participantes: { metodo: 'GET', path: '/TnWebDMDadosGerais/PegarParticipantes',
              params: { codigoempresa: '{codigo_questor}' },
              mapa: { cnpj: 'InscricaoFederal', descricao: 'Nome', regime: 'RegimeTributario', uf: 'UF', municipio: 'Municipio' } },

  entradas: { metodo: 'GET', path: '/TnWebDMFiscal/PegarLancamentosEntrada',
              params: { codigoempresa: '{codigo_questor}', datainicial: '{inicio}', datafinal: '{fim}' },
              mapa: { nome: 'NomeParticipante', inscr_federal: 'InscricaoFederal', descricao: 'DescricaoProduto',
                      ncm: 'NCM', valor: 'ValorTotal', base_calculo: 'BaseCalculoICMS', icms: 'ValorICMS',
                      icms_st: 'ValorICMSST', ipi: 'ValorIPI', pis: 'ValorPIS', cofins: 'ValorCOFINS',
                      iss: 'ValorISS', cfop: 'CFOP', cst: 'CST', competencia: 'Competencia' } },

  saidas: { metodo: 'GET', path: '/TnWebDMFiscal/PegarLancamentosSaida',
              params: { codigoempresa: '{codigo_questor}', datainicial: '{inicio}', datafinal: '{fim}' },
              mapa: { nome: 'NomeParticipante', inscr_federal: 'InscricaoFederal', descricao: 'DescricaoProduto',
                      ncm: 'NCM', valor: 'ValorTotal', base_calculo: 'BaseCalculoICMS', icms: 'ValorICMS',
                      icms_st: 'ValorICMSST', ipi: 'ValorIPI', pis: 'ValorPIS', cofins: 'ValorCOFINS',
                      iss: 'ValorISS', cfop: 'CFOP', cst: 'CST', competencia: 'Competencia' } },

  apuracao: { metodo: 'GET', path: '/TnWebDMFiscal/PegarApuracaoImpostos',
              params: { codigoempresa: '{codigo_questor}', datainicial: '{inicio}', datafinal: '{fim}' },
              mapa: { competencia: 'Competencia', receita_bruta: 'ReceitaBruta', icms: 'ICMS', iss: 'ISS',
                      ipi: 'IPI', pis: 'PIS', cofins: 'COFINS', das: 'DAS', creditos_tomados: 'Creditos' } },
};

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite = require('../src/sqlite');
const apuracoes = require('../src/services/apuracoesPisCofinsIa');
const perfil = require('../src/services/perfilTributarioHistorico');
const azure = require('../src/services/azureDocumentIntelligence');

const endpointAnterior = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
const chaveAnterior = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = 'https://document-intelligence.exemplo';
process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'chave-de-teste';
assert.strictEqual(azure.config().ativo, true, 'Azure deve ser ativado somente por variáveis de ambiente');
if (endpointAnterior === undefined) delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT; else process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = endpointAnterior;
if (chaveAnterior === undefined) delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY; else process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = chaveAnterior;

const db = sqlite.abrir(':memory:');
db.exec(`
  CREATE TABLE empresas (id INTEGER PRIMARY KEY, razao_social TEXT, regime TEXT);
  CREATE TABLE pis_cofins_apuracao_documentos (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER, nome_original TEXT, tipo_documento TEXT, mime_type TEXT, conteudo_original BLOB, hash_sha256 TEXT, competencia_detectada TEXT, data_processamento TEXT, versao_modelo_extracao TEXT, status_processamento TEXT);
  CREATE TABLE pis_cofins_apuracoes_historicas (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER, documento_id INTEGER, competencia TEXT, regime_pis_cofins TEXT, receita_base REAL, pis_debito REAL, cofins_debito REAL, pis_credito REAL, cofins_credito REAL, pis_credito_utilizado REAL, cofins_credito_utilizado REAL, saldo_pis REAL, saldo_cofins REAL, pis_recolhido REAL, cofins_recolhida REAL, observacoes TEXT, status_validacao TEXT, divergencias TEXT);
  CREATE TABLE pis_cofins_apuracao_campos (id INTEGER PRIMARY KEY AUTOINCREMENT, apuracao_id INTEGER, campo TEXT, valor_extraido TEXT, origem_documento TEXT, pagina_ou_localizacao TEXT, rotulo_original TEXT, confianca REAL, metodo_extracao TEXT, status_validacao TEXT);
  CREATE TABLE perfil_tributario (empresa_id INTEGER, competencia TEXT, receita_bruta REAL, receita_mercadorias REAL, receita_servicos REAL, receita_exportacao REAL, icms REAL, iss REAL, ipi REAL, pis REAL, cofins REAL, das REAL, creditos_tomados REAL);
  CREATE TABLE folhas_pagamento_competencias (empresa_id INTEGER, competencia TEXT, valor_folha REAL);
  CREATE TABLE margens_operacionais_premissas (empresa_id INTEGER, periodo_inicio TEXT, periodo_fim TEXT, margem_operacional_percentual REAL);
  CREATE TABLE receitas_sem_dfe (empresa_id INTEGER, competencia TEXT, valor REAL);
  CREATE TABLE perfil_cbs_competencias (empresa_id INTEGER, competencia TEXT, cbs_debito REAL, cbs_credito REAL, cbs_liquida REAL, motor_execucao_id INTEGER, receita_reducao_cbs REAL, receita_aliquota_zero_cbs REAL, receita_imunidade_cbs REAL, receita_regime_especifico_cbs REAL, receita_beneficio_governo_cbs REAL);
  CREATE TABLE movimentos (empresa_id INTEGER, competencia TEXT, tipo TEXT, sentido TEXT, valor REAL, iss REAL);
`);
db.prepare("INSERT INTO empresas VALUES (1,'Empresa A','lucro_presumido'),(2,'Empresa B','lucro_real')").run();

const completo = {
  competencia: { valor_extraido: '2026-07', origem_documento: 'relatório', pagina_ou_localizacao: 'p. 1', rotulo_original: 'Período', confianca: 0.99, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  regime_pis_cofins: { valor_extraido: 'CUMULATIVO', origem_documento: 'relatório', pagina_ou_localizacao: 'p. 1', rotulo_original: 'Regime', confianca: 0.95, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  receita_base: { valor_extraido: 1000, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Receita', confianca: 0.98, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  pis_debito: { valor_extraido: 6.5, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Débito PIS', confianca: 0.97, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  cofins_debito: { valor_extraido: 30, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Débito Cofins', confianca: 0.35, status_validacao: 'REQUER_VALIDACAO' },
  pis_credito: { valor_extraido: 2, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Crédito PIS', confianca: 0.9, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  cofins_credito: { valor_extraido: 8, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Crédito Cofins', confianca: 0.9, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  pis_credito_utilizado: { valor_extraido: 1, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Crédito usado', confianca: 0.9, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  cofins_credito_utilizado: { valor_extraido: 4, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Crédito usado', confianca: 0.9, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  saldo_pis: { valor_extraido: 5.5, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Saldo PIS', confianca: 0.9, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  saldo_cofins: { valor_extraido: 26, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Saldo Cofins', confianca: 0.9, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  pis_recolhido: { valor_extraido: 5.5, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Recolhido', confianca: 0.9, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  cofins_recolhida: { valor_extraido: 26, origem_documento: 'tabela', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Recolhido', confianca: 0.9, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  observacoes: { valor_extraido: 'Apuração importada', origem_documento: 'rodapé', pagina_ou_localizacao: 'p. 2', rotulo_original: 'Observações', confianca: 0.9, status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
};
const r = apuracoes.ingestao(db, 1, { nome_original: 'apuracao.csv', tipo_documento: 'CSV', mime_type: 'text/csv', conteudo_original: Buffer.from('arquivo A'), versao_modelo_extracao: 'modelo-teste' }, completo);
assert.ok(r.hash_sha256.length === 64);
assert.strictEqual(r.divergencias.length, 0);
assert.strictEqual(apuracoes.listarParaRevisao(db, 1)[0].campos_extraidos.length, 14);
assert.strictEqual(apuracoes.listarParaRevisao(db, 1)[0].campos_extraidos.find((x) => x.campo === 'cofins_debito').confianca, 0.35);
const confirmado = apuracoes.confirmarRevisao(db, 1, r.apuracao_id);
assert.strictEqual(confirmado.status_validacao, 'VALIDADO_USUARIO');
assert.strictEqual(confirmado.campos_extraidos.find((x) => x.campo === 'pis_debito').status_validacao, 'VALIDADO_USUARIO');
assert.strictEqual(confirmado.campos_extraidos.find((x) => x.campo === 'observacoes').status_validacao, 'VALIDADO_USUARIO');

const raio = perfil.consolidar(db, 1).historico[0];
assert.strictEqual(raio.apuracao_pis_cofins_historica.pis_debito.valor, 6.5);
assert.strictEqual(raio.apuracao_pis_cofins_historica.hash_lineage, r.hash_sha256);

const parcial = apuracoes.ingestao(db, 2, { nome_original: 'parcial.csv', tipo_documento: 'CSV', mime_type: 'text/csv', conteudo_original: Buffer.from('arquivo B'), versao_modelo_extracao: 'modelo-teste' }, {
  competencia: { valor_extraido: '2026-08', status_validacao: 'VALIDADO_AUTOMATICAMENTE' },
  pis_debito: { valor_extraido: null, status_validacao: 'INDETERMINADO' },
});
assert.strictEqual(parcial.campos.find((x) => x.campo === 'pis_debito').valor_extraido, null, 'ausência deve permanecer NULL');
assert.strictEqual(apuracoes.listarParaRevisao(db, 2).length, 1, 'empresa não pode ler apuração de outra empresa');
assert.throws(() => apuracoes.ingestao(db, 1, { nome_original: 'renomeado.csv', tipo_documento: 'CSV', conteudo_original: Buffer.from('arquivo A') }, completo), /já foi ingerido/);
const telaPerfil = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'telas.js'), 'utf8');
assert.match(telaPerfil, /Apurações Históricas de PIS\/Cofins/);
assert.match(telaPerfil, /Confirmar dados/);
assert.match(telaPerfil, /Não identificado/);
assert.match(telaPerfil, /apuracoes-pis-cofins\/\$\{b\.dataset\.apuracaoConfirmar\}\/confirmar/);
assert.match(telaPerfil, /fd\.append\('arquivo', arquivo\)/, 'modal deve enviar o campo multipart arquivo');
assert.match(telaPerfil, /apuracoes-pis-cofins\/ingestao/, 'modal deve usar a rota de ingestão');
assert.match(telaPerfil, /onclick = \(\) => enviarApuracao\(false\)/, 'MouseEvent não pode acionar reprocessamento');
db.close();
console.log('Fase 4C.3: ingestão e tela preservam documento, NULL, confiança, revisão, confirmação, isolamento e Raio-X.');

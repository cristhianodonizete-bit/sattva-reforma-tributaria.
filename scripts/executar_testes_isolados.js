/* Executa a suíte contra uma cópia temporária da base local.
 * Evita WAL/locks no diretório de trabalho e impede que testes alterem o
 * cache usado pelo servidor. Produção continua com journal_mode=WAL. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const raiz = path.join(__dirname, '..');
const origem = path.join(raiz, 'dados', 'reforma.db');
const testes = [
  'cadeia-cbs.test.js','credito-cbs.test.js','perfil-cbs.test.js','impacto-final-cbs.test.js','consolidacao-oficial.test.js','excecoes-motor.test.js','excecoes-execucao.test.js','autonomia-telemetry.test.js','cenarios.test.js','precificacao-oficial.test.js','vinculos-precificacao.test.js','precificacao-independente.test.js','relatorio-oficial.test.js','fase1-operacao.test.js','reconstrucao-base-economica.test.js','qualidade-cobertura.test.js','fase2a-cobertura.test.js','fase2a-simples-legal.test.js','fase2a-b2b-classificacao.test.js','fase2c-cenarios-automaticos.test.js','etapa5-analise-cadeia.test.js','saida-executiva.test.js','contratos-entrega1.test.js','contratos-entrega2.test.js','contratos-entrega3.test.js','acompanhamento-entrega1.test.js','acompanhamento-entrega2.test.js','acompanhamento-entrega3.test.js','cff-catalogo.test.js','etapa2o-memoria-decisao.test.js','etapa2q-endurecimento.test.js','etapa2r-orquestrador.test.js','etapa2z-catalogos-assinatura.test.js','etapa3d-autonomia-dimensoes.test.js','etapa3f3-credito-cliente-classificacao.test.js','etapa3f5-equivalencia-classificatoria.test.js','etapa3f7-propagacao-equivalencia.test.js','fase4a-implantacao-escopo.test.js','pgdas-importacao.test.js','importacao-dados-complementares.test.js','fase4a-exclusao-sincronizada.test.js','fase4b-dados-adicionais.test.js',
];
if (!fs.existsSync(origem)) throw new Error(`Fixture SQLite ausente: ${origem}`);
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-suite-'));
function migrarFixturePercentualPisCofins(caminho) {
  const db = new DatabaseSync(caminho);
  const existe = (tabela) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela);
  if (existe('param_regimes')) db.exec('UPDATE param_regimes SET pis_cofins=pis_cofins*100 WHERE pis_cofins IS NOT NULL');
  if (existe('base_ncm')) db.exec('UPDATE base_ncm SET pis_percentual=pis_percentual*100,cofins_percentual=cofins_percentual*100,percentual_reconstrucao_sugerido=percentual_reconstrucao_sugerido*100');
  if (existe('base_servicos')) db.exec('UPDATE base_servicos SET pis_percentual=pis_percentual*100,cofins_percentual=cofins_percentual*100,pis_cumulativo_percentual=pis_cumulativo_percentual*100,cofins_cumulativo_percentual=cofins_cumulativo_percentual*100,total_cumulativo_percentual=total_cumulativo_percentual*100,percentual_reconstrucao_sugerido=percentual_reconstrucao_sugerido*100');
  if (existe('empresa_servicos_fiscais')) db.exec('UPDATE empresa_servicos_fiscais SET pis_cofins=pis_cofins*100 WHERE pis_cofins IS NOT NULL');
  if (existe('enriquecimento_pis_cofins_evidencias')) db.exec('UPDATE enriquecimento_pis_cofins_evidencias SET aliquota_pis=aliquota_pis*100,aliquota_cofins=aliquota_cofins*100');
  db.close();
}
try {
  const fixture = path.join(dados, 'reforma.db');
  fs.copyFileSync(origem, fixture);
  // A suíte valida o código V2 sobre uma cópia já convertida do contrato V1.
  // O banco de trabalho jamais é alterado por este passo.
  migrarFixturePercentualPisCofins(fixture);
  const env = { ...process.env, SATTVA_DADOS: dados, SATTVA_SQLITE_JOURNAL_MODE: 'MEMORY' };
  let executados = 0;
  for (const teste of testes) {
    console.log(`TESTE_ISOLADO: ${teste}`);
    const resultado = spawnSync(process.execPath, [path.join(raiz, 'testes', teste)], { cwd: raiz, env, stdio: 'inherit' });
    executados++;
    if (resultado.status !== 0) process.exitCode = resultado.status || 1;
    if (process.exitCode) break;
  }
  if (!process.exitCode) console.log(`SUITE_ISOLADA_APROVADA: ${executados}/${testes.length} testes.`);
} finally {
  fs.rmSync(dados, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
}

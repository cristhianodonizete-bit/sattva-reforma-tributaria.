/* Executa a suíte contra uma cópia temporária da base local.
 * Evita WAL/locks no diretório de trabalho e impede que testes alterem o
 * cache usado pelo servidor. Produção continua com journal_mode=WAL. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const origem = path.join(raiz, 'dados', 'reforma.db');
const testes = [
  'cadeia-cbs.test.js','credito-cbs.test.js','perfil-cbs.test.js','impacto-final-cbs.test.js','consolidacao-oficial.test.js','excecoes-motor.test.js','excecoes-execucao.test.js','autonomia-telemetry.test.js','cenarios.test.js','precificacao-oficial.test.js','vinculos-precificacao.test.js','precificacao-independente.test.js','relatorio-oficial.test.js','fase1-operacao.test.js','reconstrucao-base-economica.test.js','qualidade-cobertura.test.js','fase2a-cobertura.test.js','fase2a-simples-legal.test.js','fase2a-b2b-classificacao.test.js','fase2c-cenarios-automaticos.test.js','etapa5-analise-cadeia.test.js','saida-executiva.test.js','contratos-entrega1.test.js','contratos-entrega2.test.js','contratos-entrega3.test.js','acompanhamento-entrega1.test.js','acompanhamento-entrega2.test.js','acompanhamento-entrega3.test.js','cff-catalogo.test.js','etapa2o-memoria-decisao.test.js','etapa2q-endurecimento.test.js','etapa2r-orquestrador.test.js','etapa2z-catalogos-assinatura.test.js','etapa3d-autonomia-dimensoes.test.js','etapa3f3-credito-cliente-classificacao.test.js','etapa3f5-equivalencia-classificatoria.test.js','etapa3f7-propagacao-equivalencia.test.js','fase4a-implantacao-escopo.test.js','fase4a-exclusao-sincronizada.test.js','fase4b-dados-adicionais.test.js',
];
if (!fs.existsSync(origem)) throw new Error(`Fixture SQLite ausente: ${origem}`);
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-suite-'));
try {
  fs.copyFileSync(origem, path.join(dados, 'reforma.db'));
  const env = { ...process.env, SATTVA_DADOS: dados, SATTVA_SQLITE_JOURNAL_MODE: 'MEMORY' };
  for (const teste of testes) {
    const resultado = spawnSync(process.execPath, [path.join(raiz, 'testes', teste)], { cwd: raiz, env, stdio: 'inherit' });
    if (resultado.status !== 0) process.exitCode = resultado.status || 1;
    if (process.exitCode) break;
  }
} finally {
  fs.rmSync(dados, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
}

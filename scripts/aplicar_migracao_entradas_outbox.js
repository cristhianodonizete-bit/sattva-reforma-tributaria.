// Aplica a migração da outbox das entradas Questor somente com --confirmar.
// Sem a flag, apenas mostra o que seria executado. Nunca roda no boot.
const { CAMINHO_SQL, lerSql, aplicarMigracao } = require('../src/services/entradasQuestorMigracao');

if (!process.argv.includes('--confirmar')) {
  const comandos = (lerSql().match(/^CREATE /gm) || []).length;
  console.log(`Simulação: nada foi aplicado. Arquivo: ${CAMINHO_SQL}`);
  console.log(`Comandos CREATE em uma transação: ${comandos}. Para aplicar, rode com --confirmar após autorização.`);
  process.exit(0);
}
aplicarMigracao();
console.log('Migração entradas_questor_publicacao aplicada em uma transação.');

// Backfill da outbox das entradas Questor, por empresa, em lotes com cursor.
// Sem --confirmar: só mostra quantos movimentos seriam processados (nada gravado).
// Uso: node scripts/backfill_entradas_outbox.js --empresa=<id> [--lote=100] [--max-lotes=N] [--confirmar]
// Só funciona depois da migração aplicada (scripts/aplicar_migracao_entradas_outbox.js --confirmar).
const db = require('../src/db');
const outbox = require('../src/services/entradasQuestorOutbox');

const args = process.argv.slice(2);
const valor = (nome, padrao) => { const a = args.find((x) => x.startsWith(`--${nome}=`)); return a ? a.split('=')[1] : padrao; };
const empresa = Number(valor('empresa', 0));
const lote = Number(valor('lote', 100));
const maxLotes = Number(valor('max-lotes', Infinity));
const confirmar = args.includes('--confirmar');

if (!outbox.tabelaPresente()) { console.log('Migração da outbox não aplicada. Nada a fazer.'); process.exit(1); }
if (!empresa) { console.log('Informe --empresa=<id>.'); process.exit(1); }

const total = db.prepare(`SELECT COUNT(*) AS n FROM movimentos WHERE empresa_id=? AND origem IN ('QUESTOR_CONCILIACAO_ENTRADA','QUESTOR_RAZAO')`).get(empresa).n;
if (!confirmar) {
  console.log(`Simulação: ${total} movimentos Questor na empresa ${empresa}. Nada foi gravado. Use --confirmar após revisar.`);
  process.exit(0);
}
(async () => {
  const operacao = require('../src/services/operacaoCompartilhada');
  const resultado = await outbox.backfillEntradasQuestor(empresa, {
    lote, maxLotes, confirmar: (identidades) => operacao.confirmarEntradasQuestorNaFonte(empresa, identidades),
  });
  console.log(JSON.stringify(resultado, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });

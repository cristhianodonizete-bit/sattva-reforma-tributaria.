// Encerra somente a sessão PostgreSQL explicitamente informada após conferência.
require('dotenv').config();
const { Client } = require('pg');
async function main() {
  const pid = Number(process.argv[2]);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Informe um PID PostgreSQL válido.');
  const db = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await db.connect();
  try {
    const alvo = await db.query('SELECT pid,state,LEFT(query,500) query FROM pg_stat_activity WHERE pid=$1', [pid]);
    if (alvo.rows.length !== 1) throw new Error('Sessão não encontrada.');
    if (!/parceiros.*ativo=false/i.test(String(alvo.rows[0].query || ''))) throw new Error('A sessão indicada não é a consolidação de parceiros esperada.');
    const encerrada = await db.query('SELECT pg_terminate_backend($1) AS encerrada', [pid]);
    console.log(JSON.stringify({ pid, encerrada:Boolean(encerrada.rows[0].encerrada), rollback_esperado:true }, null, 2));
  } finally { await db.end(); }
}
main().catch((erro)=>{ console.error(erro.message); process.exitCode=1; });

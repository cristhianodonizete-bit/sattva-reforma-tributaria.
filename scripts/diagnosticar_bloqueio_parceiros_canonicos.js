// Somente leitura: identifica sessões que bloqueiam a tabela canônica de parceiros.
require('dotenv').config();
const { Client } = require('pg');
async function main() {
  const db = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await db.connect();
  try {
    const r = await db.query(`SELECT pid,usename,application_name,state,wait_event_type,wait_event,
      query_start,now()-query_start AS duracao,LEFT(query,500) AS query
      FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND (query ILIKE '%parceiros%' OR wait_event_type='Lock') ORDER BY query_start`);
    console.log(JSON.stringify({ somente_leitura:true, sessoes:r.rows }, null, 2));
  } finally { await db.end(); }
}
main().catch((erro)=>{ console.error(erro.message); process.exitCode=1; });

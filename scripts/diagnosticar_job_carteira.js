require('dotenv').config();
const { Client } = require('pg');

const id = String(process.argv[2] || '').trim();
if (!id) throw new Error('Informe o identificador do job da carteira.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT id,status,tentativas,max_tentativas,erro,criado_em,iniciado_em,heartbeat,proxima_tentativa_em,finalizado_em
      FROM public.jobs_carteira WHERE id=$1`, [id]);
    console.log(JSON.stringify(rows[0] || null, null, 2));
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exitCode = 1; });

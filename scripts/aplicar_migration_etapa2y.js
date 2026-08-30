const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');

(async () => {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL ausente.');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260904_retro_link_catalogo_servicos.sql'), 'utf8');
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log(JSON.stringify({ migration: '20260904_retro_link_catalogo_servicos.sql', aplicada: true }));
  } catch (erro) {
    try { await client.query('rollback'); } catch (_) {}
    throw erro;
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

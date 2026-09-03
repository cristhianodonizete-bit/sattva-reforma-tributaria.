const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260916_responsaveis_usuarios.sql'), 'utf8'));
    await client.query('commit');
    console.log('Migration de responsáveis por usuário aplicada.');
  } catch (erro) {
    try { await client.query('rollback'); } catch (_) { /* ignore */ }
    throw erro;
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

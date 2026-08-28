require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');

const arquivo = process.argv[2];
if (!arquivo) throw new Error('Informe o arquivo SQL da migration.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(fs.readFileSync(arquivo, 'utf8'));
    await client.query('commit');
    console.log(`Migration aplicada: ${arquivo}`);
  } catch (erro) {
    await client.query('rollback');
    throw erro;
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

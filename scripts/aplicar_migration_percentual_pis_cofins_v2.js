/* Aplicador deliberado da migration V2. Nunca é chamado pelo servidor. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

if (!process.argv.includes('--confirmar-legado-fator-decimal-v1')) {
  throw new Error('Recusado: informe --confirmar-legado-fator-decimal-v1 após validar o snapshot do ambiente alvo.');
}
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
const arquivo = path.join(__dirname, '..', 'supabase', 'migrations', '20260918_percentuais_pontos_percentuais_pis_cofins.sql');

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.pis_cofins_percentual_legacy_verified = 'FATOR_DECIMAL_V1'");
    await client.query(fs.readFileSync(arquivo, 'utf8'));
    await client.query('COMMIT');
    console.log('Migration V2 aplicada com confirmação explícita do contrato legado.');
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    await client.end();
  }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

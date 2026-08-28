require('dotenv').config();
const { Client } = require('pg');

if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const tabelas = await client.query(`
      select relname, n_live_tup
      from pg_stat_user_tables
      where schemaname = 'public'
        and relname in (
          'catalogo_publicacoes', 'catalogo_versoes', 'catalogo_linhas_versoes',
          'catalogo_cst', 'catalogo_cclasstrib', 'catalogo_cst_cclasstrib',
          'motor_execucao_catalogos', 'regime_origens', 'regime_evidencias_cnpj'
        )
      order by relname
    `);
    const origens = await client.query(`
      select origem_evidencia, prioridade, permite_evidencia
      from regime_origens
      order by prioridade
    `);
    console.log(JSON.stringify({ tabelas: tabelas.rows, origens: origens.rows }, null, 2));
  } finally {
    await client.end();
  }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

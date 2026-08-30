const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`
      select
        count(*)::int as resultados,
        coalesce(sum((dados->>'cbs')::numeric), 0)::text as cbs,
        count(*) filter (where autonomia_calculo_cbs_propria is true)::int as calculo_cbs_propria,
        count(*) filter (where autonomia_credito_entrada is true)::int as credito_entrada,
        count(*) filter (where autonomia_credito_cliente is true)::int as credito_cliente,
        count(*) filter (where autonomia_classificatoria = 'PARCIAL')::int as classificacao_parcial,
        count(*) filter (where autonomia_diagnostico_completo is true)::int as diagnostico_completo
      from public.motor_resultados_operacionais
      where empresa_id=1 and execucao_id=14 and ativo=true`);
    const telemetria = await client.query(`select taxa_autonomia, taxa_autonomia_calculo_cbs_propria, taxa_autonomia_credito_entrada, taxa_autonomia_credito_cliente, taxa_autonomia_classificatoria, taxa_autonomia_diagnostico_completo, dimensoes_json from public.telemetria_autonomia_execucoes where execucao_id=14`);
    console.log(JSON.stringify({ resultados: rows[0], telemetria: telemetria.rows[0] || null }, null, 2));
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

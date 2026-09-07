require('dotenv').config();
const { Client } = require('pg');

(async () => {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
  const client = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await client.connect();
  try {
    const schema = await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='empresas' ORDER BY ordinal_position");
    const tabela = await client.query("SELECT to_regclass('public.empresa_periodo_analisado') AS tabela");
    const tabelaDeclaracoes = await client.query("SELECT to_regclass('public.empresa_prontidao_declaracoes') AS tabela");
    const empresas = await client.query("SELECT id,razao_social FROM public.empresas WHERE upper(razao_social) LIKE '%TRUSTON%' LIMIT 5");
    const periodos = tabela.rows[0]?.tabela && empresas.rows.length
      ? (await client.query('SELECT empresa_id,competencia_inicio,competencia_fim,atualizado_em FROM public.empresa_periodo_analisado WHERE empresa_id=$1', [empresas.rows[0].id])).rows : [];
    const auditoria = empresas.rows.length
      ? (await client.query(`SELECT criado_em, antes, depois FROM public.auditoria
          WHERE empresa_id=$1 AND acao='periodo_analisado_definido'
          ORDER BY criado_em DESC LIMIT 20`, [empresas.rows[0].id])).rows : [];
    console.log(JSON.stringify({ empresas_colunas:schema.rows, tabela_periodo:tabela.rows[0]?.tabela || null, tabela_declaracoes:tabelaDeclaracoes.rows[0]?.tabela || null, truston:empresas.rows, periodos, auditoria }, null, 2));
  } finally { await client.end(); }
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });

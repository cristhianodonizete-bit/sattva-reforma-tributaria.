/* Diagnóstico somente leitura de publicações operacionais repetidas. */
require('dotenv').config();
const { Client } = require('pg');

if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

async function main() {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized:false } });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='60s'");
    const lotes = await client.query(`
      WITH eventos AS (
        SELECT sequencia, chave, ocorrido_em
          FROM public.sincronizacao_operacional_eventos
         WHERE tabela='movimentos' AND operacao='UPDATE'
           AND ocorrido_em >= clock_timestamp() - interval '3 hours'
      )
      SELECT date_trunc('second', e.ocorrido_em) AS instante,
             count(*)::integer AS eventos,
             count(DISTINCT e.chave)::integer AS chaves,
             array_agg(DISTINCT coalesce(m.origem,'') ORDER BY coalesce(m.origem,'')) AS origens,
             count(*) FILTER (WHERE nullif(m.normalizacao_status,'') IS NOT NULL)::integer AS com_normalizacao,
             count(*) FILTER (WHERE nullif(m.classificacao_origem,'') IS NOT NULL)::integer AS com_classificacao
        FROM eventos e
        LEFT JOIN public.movimentos m ON m.id=(e.chave->>'id')::bigint
       GROUP BY 1 ORDER BY 1
    `);
    const amostra = await client.query(`
      WITH eventos AS (
        SELECT sequencia, chave, ocorrido_em,
               row_number() OVER (PARTITION BY date_trunc('second',ocorrido_em) ORDER BY sequencia) AS ordem
          FROM public.sincronizacao_operacional_eventos
         WHERE tabela='movimentos' AND operacao='UPDATE'
           AND ocorrido_em >= clock_timestamp() - interval '3 hours'
      )
      SELECT e.sequencia,e.ocorrido_em,m.id,m.empresa_id,m.origem,m.lote_id,m.chave,m.item_numero,
             m.normalizacao_status,m.classificacao_origem,m.criado_em
        FROM eventos e LEFT JOIN public.movimentos m ON m.id=(e.chave->>'id')::bigint
       WHERE e.ordem <= 3 ORDER BY e.sequencia
    `);
    const trigger = await client.query(`
      SELECT c.relname AS tabela,t.tgname,pg_get_triggerdef(t.oid,true) AS definicao,
             pg_get_functiondef(t.tgfoid) AS funcao
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname IN ('movimentos','parceiros')
         AND NOT t.tgisinternal ORDER BY c.relname,t.tgname
    `);
    const auditoria = await client.query(`
      SELECT criado_em,empresa_id,acao,entidade,entidade_id
        FROM public.auditoria
       WHERE criado_em >= clock_timestamp() - interval '3 hours'
         AND (entidade='movimentos' OR acao ILIKE '%import%' OR acao ILIKE '%classif%' OR acao ILIKE '%questor%')
       ORDER BY criado_em
    `);
    await client.query('ROLLBACK');
    const somenteAuditoria=process.argv.includes('--auditoria');
    console.log(JSON.stringify(somenteAuditoria
      ? { somente_leitura:true, auditoria:auditoria.rows }
      : { somente_leitura:true, lotes:lotes.rows, amostra:amostra.rows, auditoria:auditoria.rows, gatilhos:trigger.rows }, null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* nada */ }
    throw error;
  } finally { await client.end(); }
}

main().catch((error)=>{ console.error(error.stack || error.message); process.exitCode=1; });

// Diagnóstico somente leitura antes de consolidar parceiros canônicos.
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
  const db = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL statement_timeout='5000ms'");
    const colunas = await db.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='parceiros' ORDER BY ordinal_position");
    const referencias = await db.query("SELECT tc.table_name,kcu.column_name,tc.constraint_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_schema='public' AND ccu.table_name='parceiros' ORDER BY tc.table_name,kcu.column_name");
    const indices = await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='parceiros' ORDER BY indexname");
    const consolidacao = await db.query("SELECT to_regclass('public.parceiros_consolidacoes_auditoria') tabela, (SELECT count(*) FROM public.parceiros WHERE COALESCE(ativo,true) IS TRUE) parceiros_ativos", []).catch((erro) => ({ rows:[{ tabela:null, parceiros_ativos:null, aviso:erro.message }] }));
    await db.query('ROLLBACK');
    console.log(JSON.stringify({ somente_leitura:true, colunas:colunas.rows, referencias:referencias.rows, indices:indices.rows, consolidacao:consolidacao.rows }, null, 2));
  } finally {
    try { await db.query('ROLLBACK'); } catch (_) { /* já encerrada */ }
    await db.end();
  }
}
main().catch((erro) => { console.error(erro.message); process.exitCode = 1; });

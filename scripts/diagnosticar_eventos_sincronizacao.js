/*
 * Diagnóstico somente leitura da trilha incremental compartilhada.
 * Não cria, altera, apaga nem bloqueia objetos de negócio.
 * Uso: node scripts/diagnosticar_eventos_sincronizacao.js [--completo]
 */
require('dotenv').config();
const { Client } = require('pg');

if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

const completo = process.argv.includes('--completo');
async function consulta(cliente, sql, parametros = []) {
  return (await cliente.query(sql, parametros)).rows;
}

async function executar() {
  const cliente = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await cliente.connect();
  try {
    await cliente.query('BEGIN READ ONLY');
    await cliente.query("SET LOCAL statement_timeout = '60s'");
    const [relacao] = await consulta(cliente, `
      SELECT c.reltuples::bigint AS estimativa_linhas,
             pg_total_relation_size(c.oid) AS bytes_total,
             pg_relation_size(c.oid) AS bytes_tabela,
             pg_indexes_size(c.oid) AS bytes_indices,
             pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho_total,
             pg_size_pretty(pg_relation_size(c.oid)) AS tamanho_tabela,
             pg_size_pretty(pg_indexes_size(c.oid)) AS tamanho_indices,
             s.n_live_tup, s.n_dead_tup, s.last_vacuum, s.last_autovacuum,
             s.last_analyze, s.last_autoanalyze
        FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_stat_all_tables s ON s.relid=c.oid
       WHERE n.nspname='public' AND c.relname='sincronizacao_operacional_eventos'
    `);
    if (!relacao) throw new Error('Tabela sincronizacao_operacional_eventos não encontrada.');

    const indices = await consulta(cliente, `
      SELECT i.indexrelname AS indice, pg_get_indexdef(i.indexrelid) AS definicao,
             pg_relation_size(i.indexrelid) AS bytes,
             pg_size_pretty(pg_relation_size(i.indexrelid)) AS tamanho,
             i.idx_scan, i.idx_tup_read, i.idx_tup_fetch
        FROM pg_stat_user_indexes i
       WHERE i.schemaname='public' AND i.relname='sincronizacao_operacional_eventos'
       ORDER BY pg_relation_size(i.indexrelid) DESC
    `);
    const gatilhos = await consulta(cliente, `
      SELECT c.relname AS tabela, t.tgname AS gatilho,
             pg_get_triggerdef(t.oid, true) AS definicao
        FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND t.tgname='trg_sync_operacional_evento'
       ORDER BY c.relname
    `);
    const funcao = await consulta(cliente, `
      SELECT pg_get_functiondef(p.oid) AS definicao
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='registrar_evento_sincronizacao_operacional'
    `);
    // `ocorrido_em` não possui índice. A leitura operacional usa a PK
    // sequencial; por isso a amostra também a usa e não força dois scans dos
    // milhões de eventos apenas para diagnosticar o problema.
    const janelaRecente = await consulta(cliente, `
      WITH recentes AS (
        SELECT sequencia,tabela,operacao,chave,ocorrido_em
          FROM public.sincronizacao_operacional_eventos
         ORDER BY sequencia DESC
         LIMIT 100000
      )
      SELECT tabela, operacao, count(*)::bigint AS eventos,
             min(ocorrido_em) AS primeiro, max(ocorrido_em) AS ultimo
        FROM recentes
       GROUP BY tabela, operacao
       ORDER BY eventos DESC
    `);
    const repeticoesRecentes = await consulta(cliente, `
      WITH recentes AS (
        SELECT sequencia,tabela,operacao,chave,ocorrido_em
          FROM public.sincronizacao_operacional_eventos
         ORDER BY sequencia DESC
         LIMIT 100000
      )
      SELECT tabela, operacao, chave::text AS chave, count(*)::bigint AS eventos,
             min(ocorrido_em) AS primeiro, max(ocorrido_em) AS ultimo
        FROM recentes
       GROUP BY tabela, operacao, chave
       HAVING count(*) > 1
       ORDER BY eventos DESC
       LIMIT 50
    `);
    const distribuicaoCompleta = completo ? await consulta(cliente, `
      SELECT tabela, operacao, count(*)::bigint AS eventos,
             min(ocorrido_em) AS primeiro, max(ocorrido_em) AS ultimo
        FROM public.sincronizacao_operacional_eventos
       GROUP BY tabela, operacao
       ORDER BY eventos DESC
    `) : [];
    const checkpoints = await consulta(cliente, `
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema='public'
         AND (table_name ILIKE '%checkpoint%' OR table_name ILIKE '%sincron%estado%' OR table_name ILIKE '%consumer%')
       ORDER BY table_name
    `);
    await cliente.query('ROLLBACK');
    console.log(JSON.stringify({
      somente_leitura: true,
      modo: completo ? 'completo' : 'amostra_100_mil_mais_recentes',
      relacao,
      indices,
      gatilhos: { quantidade: gatilhos.length, tabelas: gatilhos.map((x) => x.tabela) },
      funcao_registro: funcao[0]?.definicao || null,
      eventos_amostra_100_mil_mais_recentes: janelaRecente,
      repeticoes_amostra_100_mil_mais_recentes: repeticoesRecentes,
      eventos_todo_historico: distribuicaoCompleta,
      tabelas_checkpoint_canonico: checkpoints,
    }, null, 2));
  } catch (erro) {
    try { await cliente.query('ROLLBACK'); } catch (_) { /* sem transação */ }
    throw erro;
  } finally {
    await cliente.end();
  }
}

executar().catch((erro) => { console.error(erro.stack || erro.message); process.exitCode = 1; });

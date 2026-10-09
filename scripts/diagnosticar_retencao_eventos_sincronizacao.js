/* Diagnóstico somente leitura para planejar retenção da trilha operacional. */
require('dotenv').config();
const { Client } = require('pg');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

async function main() {
  const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query("SET LOCAL statement_timeout='120s'");
    const one=async(sql)=>(await c.query(sql)).rows;
    const resumo=(await one(`select count(*)::bigint eventos,min(sequencia)::bigint sequencia_minima,max(sequencia)::bigint sequencia_maxima,
      min(ocorrido_em) primeiro_evento,max(ocorrido_em) ultimo_evento,
      count(*) filter(where sequencia_consumo is null)::bigint eventos_legados,
      count(*) filter(where sequencia_consumo is not null)::bigint eventos_v2,
      pg_total_relation_size('public.sincronizacao_operacional_eventos')::bigint bytes_total,
      pg_relation_size('public.sincronizacao_operacional_eventos')::bigint bytes_tabela,
      pg_indexes_size('public.sincronizacao_operacional_eventos')::bigint bytes_indices
      from public.sincronizacao_operacional_eventos`))[0];
    const estado=await one(`select chave,corte_sequencia_tecnica,proxima_sequencia_consumo,atualizado_em from public.sincronizacao_operacional_estado order by chave`);
    const consumidores=await one(`select consumidor_id,sequencia_confirmada,requer_carga_base,versao_protocolo,lease_expira_em,ultimo_heartbeat,atualizado_em from public.sincronizacao_operacional_consumidores order by consumidor_id`);
    const tombstones=(await one(`select count(*)::bigint total,count(*) filter(where restaurado_em is null)::bigint ativos,
      min(sequencia_exclusao)::bigint menor_sequencia_exclusao,max(sequencia_exclusao)::bigint maior_sequencia_exclusao
      from public.sincronizacao_operacional_tombstones`))[0];
    const limites=await one(`select marco,sequencia_limite,eventos_removiveis,primeiro,ultimo from (
      select 'corte_v2'::text marco,e.corte_sequencia_tecnica sequencia_limite,
        count(x.*)::bigint eventos_removiveis,min(x.ocorrido_em) primeiro,max(x.ocorrido_em) ultimo
      from public.sincronizacao_operacional_estado e left join public.sincronizacao_operacional_eventos x on x.sequencia<=e.corte_sequencia_tecnica
      where e.chave='fila_v2' group by e.corte_sequencia_tecnica
      union all
      select 'menor_checkpoint_v2',coalesce(p.checkpoint,0),count(x.*)::bigint,min(x.ocorrido_em),max(x.ocorrido_em)
      from (select min(sequencia_confirmada) checkpoint from public.sincronizacao_operacional_consumidores) p
      left join public.sincronizacao_operacional_eventos x
        on x.sequencia_consumo is not null and x.sequencia_consumo<=p.checkpoint
      group by p.checkpoint
    ) s order by marco`);
    const indices=await one(`select i.indexrelname indice,pg_get_indexdef(i.indexrelid) definicao,pg_relation_size(i.indexrelid)::bigint bytes,i.idx_scan
      from pg_stat_user_indexes i where i.schemaname='public' and i.relname='sincronizacao_operacional_eventos' order by i.indexrelname`);
    const manutencao=(await one(`select current_database() banco,
      pg_database_size(current_database())::bigint bytes_banco,
      n_live_tup::bigint linhas_vivas_estimadas,n_dead_tup::bigint linhas_mortas_estimadas,
      last_vacuum,last_autovacuum,last_analyze,last_autoanalyze
      from pg_stat_user_tables where schemaname='public' and relname='sincronizacao_operacional_eventos'`))[0];
    const extensoes=await one(`select e.extname,e.extversion from pg_extension e
      where e.extname in ('pg_cron','pg_repack') order by e.extname`);
    const cron=await one(`select to_regclass('cron.job')::text relacao,
      case when to_regnamespace('cron') is null then false
           else has_schema_privilege(current_user,to_regnamespace('cron'),'USAGE') end acesso_schema`);
    await c.query('ROLLBACK');
    console.log(JSON.stringify({somente_leitura:true,resumo,estado,consumidores,tombstones,limites,indices,manutencao,extensoes,cron},null,2));
  } catch(e) { try{await c.query('ROLLBACK')}catch(_){} throw e; }
  finally { await c.end(); }
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

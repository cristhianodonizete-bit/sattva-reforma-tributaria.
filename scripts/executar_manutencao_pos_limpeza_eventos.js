require('dotenv').config();
const {Client}=require('pg');
if(!process.argv.includes('--executar')) throw new Error('Modo seguro: inclua --executar somente após aprovação.');
if(!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
const comandos=[
  'vacuum (analyze, verbose) public.sincronizacao_operacional_eventos',
  'drop index concurrently if exists public.ix_sync_operacional_eventos_sequencia',
  'reindex index concurrently public.ix_sync_operacional_eventos_tabela_sequencia',
  'reindex index concurrently public.ix_sync_operacional_eventos_empresa_sequencia',
  'reindex index concurrently public.sincronizacao_operacional_eventos_pkey',
  'vacuum (analyze, verbose) public.sincronizacao_operacional_eventos',
];
async function main(){
  const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}}); await c.connect();
  try{
    const tamanho=async()=>(await c.query(`select pg_total_relation_size('public.sincronizacao_operacional_eventos')::bigint total,pg_relation_size('public.sincronizacao_operacional_eventos')::bigint tabela,pg_indexes_size('public.sincronizacao_operacional_eventos')::bigint indices`)).rows[0];
    const antes=await tamanho();
    await c.query("set lock_timeout='5s'"); await c.query("set statement_timeout='0'");
    for(const comando of comandos){console.error(`iniciando: ${comando}`);await c.query(comando)}
    const depois=await tamanho();
    const indices=(await c.query(`select indexrelid::regclass::text indice,indisvalid from pg_index where indrelid='public.sincronizacao_operacional_eventos'::regclass order by 1`)).rows;
    if(indices.some(x=>!x.indisvalid)||indices.some(x=>x.indice.endsWith('ix_sync_operacional_eventos_sequencia'))) throw new Error(`Índices finais inválidos: ${JSON.stringify(indices)}`);
    console.log(JSON.stringify({resultado:'MANUTENCAO_APROVADA',antes,depois,indices},null,2));
  }finally{await c.end()}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

/* Valida hashes e restaura o arquivo em PostgreSQL descartável. */
const fs=require('fs'); const path=require('path'); const zlib=require('zlib'); const crypto=require('crypto');
const {pipeline}=require('stream/promises'); const {Client}=require('pg'); const copyFrom=require('pg-copy-streams').from;
const manifestoArquivo=path.resolve(process.argv[2]||'');
const url=process.env.ARCHIVE_RESTORE_POSTGRES_URL;
const medirLimpeza=process.env.ARCHIVE_BENCHMARK_CLEANUP==='1';
if(!process.argv[2]||!url) throw new Error('Informe o manifesto e ARCHIVE_RESTORE_POSTGRES_URL.');
const hashArquivo=async(a)=>{const h=crypto.createHash('sha256');await pipeline(fs.createReadStream(a),h);return h.digest('hex')};

async function main(){
  const diretorio=path.dirname(manifestoArquivo); const m=JSON.parse(fs.readFileSync(manifestoArquivo,'utf8'));
  let anterior=m.sequencia_inicial-1,total=0; const hashes=[];
  for(const p of m.partes){
    if(p.sequencia_inicial!==anterior+1) throw new Error(`Lacuna antes de ${p.arquivo}`);
    const arquivo=path.join(diretorio,p.arquivo); const stat=fs.statSync(arquivo); const sha=await hashArquivo(arquivo);
    if(stat.size!==p.bytes||sha!==p.sha256) throw new Error(`Parte inválida: ${p.arquivo}`);
    anterior=p.sequencia_final; total+=p.linhas; hashes.push(sha);
  }
  const hashPartes=crypto.createHash('sha256').update(hashes.join('\n')).digest('hex');
  if(anterior!==m.sequencia_final||total!==m.linhas||hashPartes!==m.sha256_manifesto_partes) throw new Error('Manifesto não corresponde às partes.');
  const c=new Client({connectionString:url,ssl:false}); await c.connect();
  try{
    await c.query(`drop table if exists public.restauracao_eventos_arquivados;
      create table public.restauracao_eventos_arquivados(
        sequencia bigint primary key,tabela text not null,operacao text not null,chave jsonb not null,
        empresa_id bigint,ocorrido_em timestamptz not null,sequencia_consumo bigint);`);
    for(const p of m.partes){
      const destino=c.query(copyFrom(`copy public.restauracao_eventos_arquivados
        (sequencia,tabela,operacao,chave,empresa_id,ocorrido_em,sequencia_consumo)
        from stdin with (format csv,header true,encoding 'UTF8')`));
      await pipeline(fs.createReadStream(path.join(diretorio,p.arquivo)),zlib.createGunzip(),destino);
    }
    const r=(await c.query(`select count(*)::bigint linhas,min(sequencia)::bigint minimo,max(sequencia)::bigint maximo,
      count(*) filter(where sequencia_consumo is not null)::bigint eventos_v2
      from public.restauracao_eventos_arquivados`)).rows[0];
    if(Number(r.linhas)!==m.linhas||Number(r.minimo)!==m.sequencia_inicial||Number(r.maximo)!==m.sequencia_final||Number(r.eventos_v2)!==0) throw new Error(`Restauração divergente: ${JSON.stringify(r)}`);
    const resultado={restauracao:'APROVADA',manifesto:manifestoArquivo,linhas:Number(r.linhas),sequencia_inicial:Number(r.minimo),sequencia_final:Number(r.maximo),eventos_v2:Number(r.eventos_v2),sha256_manifesto_partes:hashPartes};
    if(medirLimpeza){
      await c.query(`create index ix_bench_sequencia on public.restauracao_eventos_arquivados(sequencia);
        create index ix_bench_tabela_sequencia on public.restauracao_eventos_arquivados(tabela,sequencia);
        create index ix_bench_empresa_sequencia on public.restauracao_eventos_arquivados(empresa_id,sequencia) where empresa_id is not null;`);
      const tamanhoAntes=(await c.query("select pg_total_relation_size('public.restauracao_eventos_arquivados')::bigint bytes")).rows[0].bytes;
      const inicio=Date.now(); let removidos=0,lotes=0;
      for(;;){
        const x=(await c.query(`with candidatas as materialized (
          select sequencia from public.restauracao_eventos_arquivados order by sequencia limit 50000 for update skip locked
        ), apagadas as (
          delete from public.restauracao_eventos_arquivados e using candidatas c where e.sequencia=c.sequencia returning 1
        ) select count(*)::int removidos from apagadas`)).rows[0];
        const n=Number(x.removidos); removidos+=n; lotes++;
        if(n===0) break;
        if(lotes%25===0) console.error(`benchmark: ${removidos}/${m.linhas}`);
      }
      const deleteMs=Date.now()-inicio;
      await c.query('vacuum (analyze) public.restauracao_eventos_arquivados');
      const tamanhoAposVacuum=(await c.query("select pg_total_relation_size('public.restauracao_eventos_arquivados')::bigint bytes")).rows[0].bytes;
      const inicioFull=Date.now(); await c.query('vacuum full public.restauracao_eventos_arquivados'); const vacuumFullMs=Date.now()-inicioFull;
      const tamanhoAposFull=(await c.query("select pg_total_relation_size('public.restauracao_eventos_arquivados')::bigint bytes")).rows[0].bytes;
      resultado.benchmark={lote:50000,lotes,removidos,delete_ms:deleteMs,bytes_antes:Number(tamanhoAntes),bytes_apos_vacuum:Number(tamanhoAposVacuum),vacuum_full_ms:vacuumFullMs,bytes_apos_vacuum_full:Number(tamanhoAposFull)};
    }
    console.log(JSON.stringify(resultado,null,2));
  }finally{await c.end()}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

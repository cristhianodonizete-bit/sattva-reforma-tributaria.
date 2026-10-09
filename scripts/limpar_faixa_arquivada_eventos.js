/* Limpeza destrutiva, retomável e vinculada ao manifesto validado. Não execute sem aprovação. */
require('dotenv').config();
const fs=require('fs'); const path=require('path'); const crypto=require('crypto'); const {pipeline}=require('stream/promises'); const {Client}=require('pg');
const manifestoArquivo=path.resolve(process.argv[2]||''); const executar=process.argv.includes('--executar');
if(!process.argv[2]) throw new Error('Informe o manifesto.');
if(!executar) throw new Error('Modo seguro: inclua --executar somente após a aprovação consolidada.');
if(!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
const hashArquivo=async(a)=>{const h=crypto.createHash('sha256');await pipeline(fs.createReadStream(a),h);return h.digest('hex')};

async function validarArquivo(){
  const m=JSON.parse(fs.readFileSync(manifestoArquivo,'utf8')); const dir=path.dirname(manifestoArquivo);
  let anterior=m.sequencia_inicial-1,linhas=0; const hashes=[];
  for(const p of m.partes){
    const a=path.join(dir,p.arquivo); const s=fs.statSync(a); const h=await hashArquivo(a);
    if(p.sequencia_inicial!==anterior+1||s.size!==p.bytes||h!==p.sha256) throw new Error(`Parte inválida: ${p.arquivo}`);
    anterior=p.sequencia_final; linhas+=p.linhas; hashes.push(h);
  }
  const agregado=crypto.createHash('sha256').update(hashes.join('\n')).digest('hex');
  if(anterior!==m.sequencia_final||linhas!==m.linhas||agregado!==m.sha256_manifesto_partes) throw new Error('Manifesto inválido.');
  return m;
}

async function main(){
  const m=await validarArquivo(); const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}}); await c.connect();
  let bloqueio=false,removidosSessao=0,lotes=0;
  try{
    bloqueio=(await c.query("select pg_try_advisory_lock(hashtextextended('limpeza_sincronizacao_operacional_eventos',0)) ok")).rows[0].ok;
    if(!bloqueio) throw new Error('Outra limpeza já está em execução.');
    const estado=(await c.query(`select e.corte_sequencia_tecnica,
      (select count(*)::bigint from public.sincronizacao_operacional_eventos x where x.sequencia between $1 and $2) restantes,
      (select count(*)::bigint from public.sincronizacao_operacional_eventos x where x.sequencia between $1 and $2 and x.sequencia_consumo is not null) v2,
      exists(select 1 from public.sincronizacao_operacional_consumidores c where c.requer_carga_base is false and c.ultimo_heartbeat>=clock_timestamp()-interval '10 minutes') consumidor_ativo
      from public.sincronizacao_operacional_estado e where e.chave='fila_v2'`,[m.sequencia_inicial,m.sequencia_final])).rows[0];
    if(!estado||Number(estado.corte_sequencia_tecnica)!==m.sequencia_final) throw new Error(`Corte v2 divergente: ${JSON.stringify(estado)}`);
    if(Number(estado.v2)!==0||Number(estado.restantes)>m.linhas||!estado.consumidor_ativo) throw new Error(`Pré-condições recusadas: ${JSON.stringify(estado)}`);
    await c.query(`insert into public.sincronizacao_operacional_arquivos
      (tabela,sequencia_inicial,sequencia_final,linhas,bytes_arquivo,sha256_manifesto_partes,armazenamento,gerado_em,validado_em)
      values($1,$2,$3,$4,$5,$6,'copia externa validada; localização não registrada no banco',$7,clock_timestamp())
      on conflict(tabela,sequencia_inicial,sequencia_final) do update set
        linhas=excluded.linhas,bytes_arquivo=excluded.bytes_arquivo,sha256_manifesto_partes=excluded.sha256_manifesto_partes,
        armazenamento=excluded.armazenamento,validado_em=excluded.validado_em`,[m.tabela,m.sequencia_inicial,m.sequencia_final,m.linhas,m.bytes_arquivo,m.sha256_manifesto_partes,m.gerado_em]);
    for(;;){
      await c.query('begin');
      try{
        await c.query("set local lock_timeout='2s'"); await c.query("set local statement_timeout='60s'");
        const r=(await c.query(`with candidatas as materialized (
          select sequencia from public.sincronizacao_operacional_eventos
          where sequencia between $1 and $2 order by sequencia limit 50000 for update skip locked
        ), apagadas as (
          delete from public.sincronizacao_operacional_eventos e using candidatas x where e.sequencia=x.sequencia returning 1
        ) select count(*)::int removidos from apagadas`,[m.sequencia_inicial,m.sequencia_final])).rows[0];
        await c.query('commit'); const n=Number(r.removidos); removidosSessao+=n; lotes++;
        if(n===0) break;
        if(lotes%10===0) console.error(`removidos nesta execução: ${removidosSessao}`);
      }catch(e){try{await c.query('rollback')}catch(_){} throw e}
    }
    const restantes=Number((await c.query('select count(*)::bigint total from public.sincronizacao_operacional_eventos where sequencia between $1 and $2',[m.sequencia_inicial,m.sequencia_final])).rows[0].total);
    if(restantes!==0) throw new Error(`Limpeza incompleta: ${restantes} registros restantes.`);
    await c.query(`update public.sincronizacao_operacional_arquivos set removido_em=clock_timestamp()
      where tabela=$1 and sequencia_inicial=$2 and sequencia_final=$3`,[m.tabela,m.sequencia_inicial,m.sequencia_final]);
    console.log(JSON.stringify({resultado:'FAIXA_REMOVIDA',removidos_nesta_execucao:removidosSessao,lotes,restantes,manifesto_sha256:m.sha256_manifesto_partes},null,2));
  }finally{if(bloqueio)try{await c.query("select pg_advisory_unlock(hashtextextended('limpeza_sincronizacao_operacional_eventos',0))")}catch(_){} await c.end()}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

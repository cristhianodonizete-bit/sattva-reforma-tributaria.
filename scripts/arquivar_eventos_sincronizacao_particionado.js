/* Arquivo recuperável e retomável em partes, sem escrita no PostgreSQL. */
require('dotenv').config();
const fs=require('fs'); const path=require('path'); const zlib=require('zlib'); const crypto=require('crypto');
const {pipeline}=require('stream/promises'); const {Client}=require('pg'); const copyTo=require('pg-copy-streams').to;
const limite=Number(process.argv[2]); const destino=path.resolve(process.argv[3]||''); const lote=250000;
if(!Number.isSafeInteger(limite)||limite<7||!process.argv[3]) throw new Error('Uso: node scripts/arquivar_eventos_sincronizacao_particionado.js LIMITE DIRETORIO');
if(!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
const conectar=async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});c.on('error',()=>{});await c.connect();return c};
const hashArquivo=async(a)=>{const h=crypto.createHash('sha256');await pipeline(fs.createReadStream(a),h);return h.digest('hex')};

async function main(){
  fs.mkdirSync(destino,{recursive:true});
  const incompleto=path.join(destino,`sincronizacao_operacional_eventos-7-${limite}.csv.gz.partial`);
  if(fs.existsSync(incompleto)) fs.unlinkSync(incompleto);
  const livre=fs.statfsSync(destino); const bytesLivres=Number(livre.bavail)*Number(livre.bsize);
  const metaClient=await conectar(); let meta;
  try{meta=(await metaClient.query(`select count(*)::bigint total,min(sequencia)::bigint minimo,max(sequencia)::bigint maximo,
    min(ocorrido_em) primeiro,max(ocorrido_em) ultimo from public.sincronizacao_operacional_eventos where sequencia between 7 and $1`,[limite])).rows[0]}
  finally{await metaClient.end()}
  if(Number(meta.minimo)!==7||Number(meta.maximo)!==limite) throw new Error(`Faixa inesperada: ${JSON.stringify(meta)}`);
  if(bytesLivres<3*1024*1024*1024) throw new Error(`Espaço local insuficiente: ${bytesLivres} bytes livres; exigidos 3 GiB.`);
  const partes=[]; let cursor=6; let linhas=0;
  while(cursor<limite){
    const c=await conectar(); let faixa;
    try{faixa=(await c.query(`select min(sequencia)::bigint inicio,max(sequencia)::bigint fim,count(*)::int total from
      (select sequencia from public.sincronizacao_operacional_eventos where sequencia>$1 and sequencia<=$2 order by sequencia limit $3) x`,[cursor,limite,lote])).rows[0]}
    finally{await c.end()}
    if(!faixa.total) break;
    const inicio=Number(faixa.inicio),fim=Number(faixa.fim); const nome=`eventos-${inicio}-${fim}.csv.gz`;
    const arquivo=path.join(destino,nome),parcial=`${arquivo}.partial`;
    if(fs.existsSync(arquivo)){
      const existente=JSON.parse(fs.readFileSync(path.join(destino,`${nome}.json`),'utf8'));
      if(existente.linhas!==faixa.total) throw new Error(`Parte existente inválida: ${nome}`);
      partes.push(existente); linhas+=existente.linhas; cursor=fim; continue;
    }
    const streamClient=await conectar();
    try{
      const origem=streamClient.query(copyTo(`copy (select sequencia,tabela,operacao,chave,empresa_id,ocorrido_em,sequencia_consumo
        from public.sincronizacao_operacional_eventos where sequencia between ${inicio} and ${fim} order by sequencia)
        to stdout with (format csv,header true,encoding 'UTF8')`));
      await pipeline(origem,zlib.createGzip({level:9}),fs.createWriteStream(parcial,{flags:'wx'}));
    }finally{await streamClient.end()}
    fs.renameSync(parcial,arquivo); const stat=fs.statSync(arquivo);
    const parte={arquivo:nome,sequencia_inicial:inicio,sequencia_final:fim,linhas:faixa.total,bytes:stat.size,sha256:await hashArquivo(arquivo)};
    fs.writeFileSync(path.join(destino,`${nome}.json`),JSON.stringify(parte,null,2),'utf8');
    partes.push(parte); linhas+=faixa.total; cursor=fim;
    console.error(`arquivadas ${linhas}/${meta.total} linhas`);
  }
  if(linhas!==Number(meta.total)||cursor!==limite) throw new Error(`Arquivo incompleto: linhas=${linhas}/${meta.total}, cursor=${cursor}/${limite}`);
  const manifesto={formato:'csv+gzip-particionado',tabela:'public.sincronizacao_operacional_eventos',sequencia_inicial:7,sequencia_final:limite,
    linhas,primeiro_evento:meta.primeiro,ultimo_evento:meta.ultimo,partes,bytes_arquivo:partes.reduce((s,p)=>s+p.bytes,0),
    sha256_manifesto_partes:crypto.createHash('sha256').update(partes.map(p=>p.sha256).join('\n')).digest('hex'),gerado_em:new Date().toISOString(),somente_leitura:true};
  const manifestoArquivo=path.join(destino,`sincronizacao_operacional_eventos-7-${limite}.manifesto.json`);
  fs.writeFileSync(manifestoArquivo,JSON.stringify(manifesto,null,2),'utf8'); console.log(JSON.stringify({manifesto:manifestoArquivo,...manifesto},null,2));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

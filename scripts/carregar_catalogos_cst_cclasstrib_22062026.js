/* Carga aditiva e idempotente dos PDFs oficiais de 22/06/2026. */
const { spawnSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');

const CST_HASH='50223469835D8B37036FD99FF634F5E881EEB17269A29DAB4DAFDF9DDAE3876F';
const CCLASS_HASH='FE0E2C900D537293D50CD768621393D9AADDCCE7A9560064686E8D2EBE9A628D';
const cstPath=process.env.CST_22062026_PDF || 'C:\\Users\\cristhiano\\Downloads\\cClassTrib%202026-06-22%20%281%29_CST.pdf';
const cclassPath=process.env.CCLASSTRIB_22062026_PDF || 'C:\\Users\\cristhiano\\Downloads\\cClassTrib%202026-06-22%20%281%29.pdf';
const python=process.env.PYTHON_BIN || 'python';
const sha=(v)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const flag=(v)=>v==='1';
const date=(v)=>/^\d{2}\/\d{2}\/\d{4}$/.test(v||'') ? `${v.slice(6)}-${v.slice(3,5)}-${v.slice(0,2)}` : null;
const num=(v)=>v === '' || v == null ? null : Number(String(v).replace(',','.'));

async function snapshot(c) { const {rows}=await c.query(`select count(*)::int resultados,coalesce(sum((dados->>'cbs')::numeric),0)::text cbs from public.motor_resultados_operacionais where empresa_id=1 and execucao_id=14 and ativo=true`); return rows[0]; }
async function version(c, pub, domain, filename, hash) {
  const r=await c.query(`insert into public.catalogo_versoes(catalogo_publicacao_id,dominio,versao,origem,arquivo_nome,arquivo_hash_sha256,publicado_em,vigencia_inicio,status_versao,observacao)
    values($1,$2,'2026-06-22','ARQUIVO_OFICIAL',$3,$4,'2026-06-22','2026-01-01','VALIDADA','Carga oficial Etapa 2Z; não ativa')
    on conflict(dominio,versao,arquivo_hash_sha256) do update set observacao=excluded.observacao returning id`,[pub,domain,filename,hash]); return r.rows[0].id;
}
async function line(c, versionId, row) {
  const fields={...row.campos_origem, pagina_origem:row.pagina_origem, linha_origem:row.linha_origem};
  const hash=sha(fields);
  await c.query(`insert into public.catalogo_linhas_versoes(catalogo_versao_id,pagina_origem,linha_origem,hash_linha_sha256,dados_oficiais,campos_origem)
    values($1,$2,$3,$4,$5,$5) on conflict(catalogo_versao_id,pagina_origem,linha_origem) do nothing`,[versionId,row.pagina_origem,row.linha_origem,hash,fields]);
  const r=await c.query(`select id from public.catalogo_linhas_versoes where catalogo_versao_id=$1 and pagina_origem=$2 and linha_origem=$3`,[versionId,row.pagina_origem,row.linha_origem]);
  return r.rows[0].id;
}
(async()=>{
 if(!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL ausente.');
 const proc=spawnSync(python,[path.join(__dirname,'extrair_catalogos_22062026_oficial.py'),cstPath,cclassPath],{encoding:'utf8',maxBuffer:32*1024*1024});
 if(proc.status!==0) throw new Error(proc.stderr||proc.stdout);
 const data=JSON.parse(proc.stdout);
 if(data.hashes.cst!==CST_HASH || data.hashes.cclasstrib!==CCLASS_HASH) throw new Error('Hash dos PDFs oficiais não confere.');
 if(!data.cst.length || !data.cclasstrib.length) throw new Error('Extração oficial vazia.');
 const codes=new Set(data.cclasstrib.map(x=>x.codigo)); if(codes.size!==data.cclasstrib.length) throw new Error('cClassTrib duplicado.');
 const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}}); await c.connect();
 try {
  const antes=await snapshot(c); await c.query('begin');
  const pub=(await c.query(`insert into public.catalogo_publicacoes(referencia,publicado_em,descricao) values('CST_CCLASSTRIB_2026-06-22','2026-06-22','Publicação oficial CST e cClassTrib 22/06/2026') on conflict(referencia) do update set descricao=excluded.descricao returning id`)).rows[0].id;
  const cstVer=await version(c,pub,'CST_IBS_CBS','cClassTrib 2026-06-22 (1)_CST.pdf',CST_HASH);
  const ccVer=await version(c,pub,'CCLASSTRIB_IBS_CBS','cClassTrib 2026-06-22 (1).pdf',CCLASS_HASH);
  const cstIds=new Map();
  for(const row of data.cst){ const lid=await line(c,cstVer,row); const q=await c.query(`insert into public.catalogo_cst(catalogo_versao_id,catalogo_linha_id,codigo,descricao,ind_gibs_cbs,ind_gibs_cbs_mono,ind_gred,ind_gdif,ind_gtransf_cred,ind_gcred_pres_ibs_zfm,ind_gajuste_compet,ind_redutor_bc,campos_origem) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(catalogo_versao_id,codigo) do nothing returning id`,[cstVer,lid,row.codigo,row.descricao,flag(row.ind_gibs_cbs),flag(row.ind_gibs_cbs_mono),flag(row.ind_gred),flag(row.ind_gdif),flag(row.ind_gtransf_cred),flag(row.ind_gcred_pres_ibs_zfm),flag(row.ind_gajuste_compet),flag(row.ind_redutor_bc),row.campos_origem]); const id=q.rows[0]?.id || (await c.query('select id from public.catalogo_cst where catalogo_versao_id=$1 and codigo=$2',[cstVer,row.codigo])).rows[0].id; cstIds.set(row.codigo,id); }
  for(const row of data.cclasstrib){ const lid=await line(c,ccVer,row); const q=await c.query(`insert into public.catalogo_cclasstrib(catalogo_versao_id,catalogo_linha_id,codigo,cst_codigo_origem,cst_descricao_origem,nome,descricao,lc_redacao,lc_214_25,regulamento_cbs,regulamento_ibs,tipo_aliquota,pred_ibs,pred_cbs,ind_gtrib_regular,ind_gcred_pres_op,ind_gmono_padrao,ind_gmono_reten,ind_gmono_ret,ind_gmono_dif,ind_gp_bio_diferente,ind_gestorno_cred,tp_rbsn,vigencia_inicio,vigencia_fim,data_atualizacao,ind_nfe_abi,ind_nfe,ind_nfce,ind_cte,ind_cte_os,ind_bpe,ind_bpe_ta,ind_bpe_tm,ind_nf3e,ind_nfse,ind_nfse_via,ind_nfcom,ind_nfag,ind_nfgas,ind_dere,ind_dir,ind_duimp,anexo,link_fonte,campos_origem) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46) on conflict(catalogo_versao_id,codigo) do nothing returning id`,[ccVer,lid,row.codigo,row.cst_codigo_origem,row.cst_descricao_origem,row.nome||row.codigo,row.descricao||null,row.lc_redacao||null,row.lc_214_25||null,row.regulamento_cbs||null,row.regulamento_ibs||null,row.tipo_aliquota||null,num(row.pred_ibs),num(row.pred_cbs),flag(row.ind_gtrib_regular),flag(row.ind_gcred_pres_op),flag(row.ind_gmono_padrao),flag(row.ind_gmono_reten),flag(row.ind_gmono_ret),flag(row.ind_gmono_dif),flag(row.ind_gp_bio_diferente),flag(row.ind_gestorno_cred),row.tp_rbsn||null,date(row.vigencia_inicio),date(row.vigencia_fim),date(row.data_atualizacao),flag(row.ind_nfe_abi),flag(row.ind_nfe),flag(row.ind_nfce),flag(row.ind_cte),flag(row.ind_cte_os),flag(row.ind_bpe),flag(row.ind_bpe_ta),flag(row.ind_bpe_tm),flag(row.ind_nf3e),flag(row.ind_nfse),flag(row.ind_nfse_via),flag(row.ind_nfcom),flag(row.ind_nfag),flag(row.ind_nfgas),flag(row.ind_dere),flag(row.ind_dir),flag(row.ind_duimp),row.anexo||null,row.link_fonte||null,row.campos_origem]); const id=q.rows[0]?.id || (await c.query('select id from public.catalogo_cclasstrib where catalogo_versao_id=$1 and codigo=$2',[ccVer,row.codigo])).rows[0].id; const cstId=cstIds.get(row.cst_codigo_origem); if(!cstId) throw new Error(`CST oficial ausente: ${row.cst_codigo_origem}`); await c.query(`insert into public.catalogo_cst_cclasstrib(catalogo_linha_id,catalogo_cst_id,cst_catalogo_versao_id,catalogo_cclasstrib_id,cclasstrib_catalogo_versao_id,catalogo_publicacao_id) values($1,$2,$3,$4,$5,$6) on conflict(catalogo_cst_id,catalogo_cclasstrib_id,cst_catalogo_versao_id,cclasstrib_catalogo_versao_id) do nothing`,[lid,cstId,cstVer,id,ccVer,pub]); }
  const valid=(await c.query(`select (select count(*) from public.catalogo_cst where catalogo_versao_id=$1)::int cst,(select count(*) from public.catalogo_cclasstrib where catalogo_versao_id=$2)::int cclasstrib,(select count(*) from public.catalogo_cst_cclasstrib where cst_catalogo_versao_id=$1 and cclasstrib_catalogo_versao_id=$2)::int relacoes`,[cstVer,ccVer])).rows[0];
  if(valid.cst!==data.cst.length || valid.cclasstrib!==data.cclasstrib.length || valid.relacoes!==data.cclasstrib.length) throw new Error('Validação de contagem/relações falhou.');
  await c.query('commit'); const depois=await snapshot(c); console.log(JSON.stringify({hashes:data.hashes,cst_linhas:data.cst.length,cclasstrib_linhas:data.cclasstrib.length,versoes:{cstVer,ccVer},valid,antes,depois,regressao:JSON.stringify(antes)===JSON.stringify(depois)},null,2));
 }catch(e){try{await c.query('rollback')}catch(_){};throw e}finally{await c.end()}
})().catch(e=>{console.error(e.stack||e.message);process.exit(1)});

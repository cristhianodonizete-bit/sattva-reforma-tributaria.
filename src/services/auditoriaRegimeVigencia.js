'use strict';
const { avaliarFotografia,resolverNaData }=require('./regimeVigencia');
const supabase=require('./supabase');
const digitos=(v)=>String(v || '').replace(/\D/g,'');
const historicoDoAno=(cnpj,regime,ano,fonte)=>({cnpj,regime,versao:0,vigencia_inicio:String(ano)+'-01-01',vigencia_fim:String(ano)+'-12-31',fonte,registrado_em:''});
async function registrosDisponiveis(db,empresaId,cnpjs){
  const persistidos=db.prepare('SELECT cnpj,regime,versao,vigencia_inicio,vigencia_fim,fonte,registrado_em FROM historico_regimes_parceiro').all();
  if(!cnpjs.length)return persistidos;
  let compartilhados=[];
  if(supabase.configurado()){
    const raizesRemotas=[...new Set(cnpjs.map((x)=>x.slice(0,8)))]
    const remoto=supabase.admin();
    const [porCnpj,porRaiz]=await Promise.all([remoto.from('historico_regimes_cnpj').select('cnpj,raiz,regime,versao,vigencia_inicio,vigencia_fim,fonte,registrado_em').in('cnpj',cnpjs),remoto.from('historico_regimes_cnpj').select('cnpj,raiz,regime,versao,vigencia_inicio,vigencia_fim,fonte,registrado_em').in('raiz',raizesRemotas)]);
    if(porCnpj.error)throw new Error(`Histórico compartilhado: ${porCnpj.error.message}`);
    if(porRaiz.error)throw new Error(`Histórico compartilhado: ${porRaiz.error.message}`);
    compartilhados=[...(porCnpj.data||[]),...(porRaiz.data||[])];
  }
  const raizes=[...new Set(cnpjs.map(x=>x.slice(0,8)))]; const q1=cnpjs.map(()=>'?').join(','); const q2=raizes.map(()=>'?').join(',');
  const bases=db.prepare('SELECT cnpj,raiz,regime,ano,fonte FROM base_regime WHERE cnpj IN ('+q1+') OR raiz IN ('+q2+')').all(...cnpjs,...raizes);
  const evidencias=db.prepare("SELECT p.cnpj,e.regime,e.ano_referencia,e.fonte FROM contraparte_regime_evidencias e JOIN parceiros p ON p.id=e.parceiro_id WHERE p.empresa_id=? AND p.tipo='fornecedor'").all(Number(empresaId));
  const anuais=[...bases.map(x=>historicoDoAno(x.cnpj||x.raiz,x.regime,x.ano,x.fonte||'Base RFB')),...evidencias.filter(x=>Number(x.ano_referencia)>0).map(x=>historicoDoAno(x.cnpj,x.regime,x.ano_referencia,x.fonte||'Evidência cadastral'))];
  return [...persistidos,...compartilhados,...anuais];
}
async function listar(db,empresaId){
  const execucao=db.prepare('SELECT id FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(Number(empresaId));
  if(!execucao)return {execucao_id:null,resumo:{total:0,atual:0,divergente:0,sem_historico:0},itens:[]};
  const itens=db.prepare("SELECT m.id movimento_id,m.inscr_federal cnpj,m.documento,m.competencia,m.data_emissao,COALESCE(NULLIF(json_extract(CASE WHEN json_valid(COALESCE(r.detalhe,'')) THEN r.detalhe ELSE '{}' END,'$.regimeEmitente'),''),r.regime_cbs_emitente,m.regime) regime_fotografia,m.regime_parceiro_versao versao_fotografia FROM motor_resultados r JOIN movimentos m ON m.id=r.movimento_id WHERE r.empresa_id=? AND r.execucao_id=? AND r.sentido='entrada' AND LENGTH(REPLACE(REPLACE(REPLACE(m.inscr_federal,'.',''),'/',''),'-',''))=14 ORDER BY m.competencia,m.id").all(Number(empresaId),Number(execucao.id));
  const cnpjs=[...new Set(itens.map(x=>digitos(x.cnpj)))]; const porCnpj=new Map();
  for(const r of await registrosDisponiveis(db,empresaId,cnpjs)){const k=digitos(r.cnpj); if(!porCnpj.has(k))porCnpj.set(k,[]); porCnpj.get(k).push(r); const raiz=digitos(r.raiz)||k.slice(0,8); if(raiz.length===8)for(const c of cnpjs)if(c.startsWith(raiz)){if(!porCnpj.has(c))porCnpj.set(c,[]); if(c!==k)porCnpj.get(c).push({...r,cnpj:c});}}
  const auditados=itens.map(x=>{
    const parte=String(x.data_emissao||x.competencia||'').slice(0,7);
    const dataDocumento=/^\d{4}-\d{2}$/.test(parte)?parte+'-01':parte;
    const registros=porCnpj.get(digitos(x.cnpj))||[];
    const vigente=resolverNaData(registros,x.cnpj,dataDocumento);
    return {...x,data_documento:dataDocumento,...avaliarFotografia({registros,cnpj:x.cnpj,dataDocumento,regimeFotografia:x.regime_fotografia,versaoFotografia:x.versao_fotografia}),fonte_vigente:vigente?.fonte||null,vigencia_inicio:vigente?.vigencia_inicio||null,vigencia_fim:vigente?.vigencia_fim||null};
  });
  const resumo={total:auditados.length,atual:auditados.filter(x=>x.status==='ATUAL').length,divergente:auditados.filter(x=>x.status==='DIVERGENTE').length,sem_historico:auditados.filter(x=>x.status==='SEM_HISTORICO').length};
  // Só há cobertura quando a vigência da evidência alcança a data da nota.
  const grupos=new Map();
  for(const item of auditados){
    const ano=String(item.data_documento||'').slice(0,4)||'sem_data';
    if(!grupos.has(ano))grupos.set(ano,{ano,documentos:0,cnpjs:new Set(),com_cobertura:0,sem_cobertura:0,fontes:new Map()});
    const grupo=grupos.get(ano); grupo.documentos++; grupo.cnpjs.add(digitos(item.cnpj));
    if(item.status==='SEM_HISTORICO')grupo.sem_cobertura++;
    else {const fonte=item.fonte_vigente||'Histórico cadastrado'; grupo.com_cobertura++; grupo.fontes.set(fonte,(grupo.fontes.get(fonte)||0)+1);}
  }
  const cobertura=[...grupos.values()].sort((a,b)=>String(a.ano).localeCompare(String(b.ano))).map(x=>({ano:x.ano,documentos:x.documentos,cnpjs:x.cnpjs.size,com_cobertura:x.com_cobertura,sem_cobertura:x.sem_cobertura,fontes:[...x.fontes.entries()].map(([fonte,documentos])=>({fonte,documentos}))}));
  return {execucao_id:Number(execucao.id),resumo,cobertura,itens:auditados};
}
module.exports={listar,registrosDisponiveis};
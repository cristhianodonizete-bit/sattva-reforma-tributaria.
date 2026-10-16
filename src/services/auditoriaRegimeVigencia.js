'use strict';
const { avaliarFotografia,resolverNaData }=require('./regimeVigencia');
const supabase=require('./supabase');
const {execucaoDaFotografiaOficial}=require('./fotografiaOficial');
const digitos=(v)=>String(v || '').replace(/\D/g,'');
const regimeGenerico=(v)=>['','indeterminado','regime_regular'].includes(String(v || '').trim().toLowerCase());
const historicoDoAno=(cnpj,regime,ano,fonte)=>({cnpj,regime,versao:0,vigencia_inicio:String(ano)+'-01-01',vigencia_fim:String(ano)+'-12-31',fonte,registrado_em:''});
// Regra aprovada: a última base anual disponível de não-Simples continua como
// referência até surgir base anual mais nova ou confirmação manual datada.
const referenciaAnualAnterior=(cnpj,regime,ano,fonte)=>({cnpj,regime,versao:0,vigencia_inicio:String(ano)+'-01-01',vigencia_fim:null,fonte:`${fonte || 'Base RFB'} (referência anual anterior)`,registrado_em:''});
async function registrosDisponiveis(db,empresaId,cnpjs){
  const persistidos=db.prepare('SELECT cnpj,regime,versao,vigencia_inicio,vigencia_fim,fonte,registrado_em FROM historico_regimes_parceiro').all();
  if(!cnpjs.length)return persistidos;
  let compartilhados=[], cadastrosCanonicos=[];
  if(supabase.configurado()){
    const raizesRemotas=[...new Set(cnpjs.map((x)=>x.slice(0,8)))];
    const remoto=supabase.admin();
    const [porCnpj,porRaiz,cadastrosExatos]=await Promise.all([
      remoto.from('historico_regimes_cnpj').select('cnpj,raiz,regime,versao,vigencia_inicio,vigencia_fim,fonte,registrado_em').in('cnpj',cnpjs),
      remoto.from('historico_regimes_cnpj').select('cnpj,raiz,regime,versao,vigencia_inicio,vigencia_fim,fonte,registrado_em').in('raiz',raizesRemotas),
      remoto.from('cadastros_cnpj').select('cnpj,regime_derivado,fonte,consultado_em').in('cnpj',cnpjs)
    ]);
    if(porCnpj.error)throw new Error(`Histórico compartilhado: ${porCnpj.error.message}`);
    if(porRaiz.error)throw new Error(`Histórico compartilhado: ${porRaiz.error.message}`);
    if(cadastrosExatos.error)throw new Error(`Cadastro compartilhado: ${cadastrosExatos.error.message}`);
    compartilhados=[...(porCnpj.data||[]),...(porRaiz.data||[])];
    cadastrosCanonicos=(cadastrosExatos.data||[]).filter((x)=>String(x.regime_derivado||'').trim()).map((x)=>({cnpj:x.cnpj,raiz:digitos(x.cnpj).slice(0,8),regime:x.regime_derivado,versao:null,vigencia_inicio:'0000-01-01',vigencia_fim:null,fonte:`Cadastro compartilhado: ${x.fonte||'origem não informada'}`,registrado_em:x.consultado_em||'',canonica:true,escopo_cadastro:'CNPJ'}));
    // Busca por raiz mantém a regra já adotada para filiais; é feita em lotes
    // para não exceder o limite do filtro OR do PostgREST.
    for(let i=0;i<raizesRemotas.length;i+=20){
      const lote=raizesRemotas.slice(i,i+20); const {data,error}=await remoto.from('cadastros_cnpj').select('cnpj,regime_derivado,fonte,consultado_em').or(lote.map((raiz)=>`cnpj.like.${raiz}%`).join(','));
      if(error)throw new Error(`Cadastro compartilhado: ${error.message}`);
      for(const x of (data||[]))if(String(x.regime_derivado||'').trim())cadastrosCanonicos.push({cnpj:x.cnpj,raiz:digitos(x.cnpj).slice(0,8),regime:x.regime_derivado,versao:null,vigencia_inicio:'0000-01-01',vigencia_fim:null,fonte:`Cadastro compartilhado: ${x.fonte||'origem não informada'}`,registrado_em:x.consultado_em||'',canonica:true,escopo_cadastro:'RAIZ'});
    }
  }
  const raizes=[...new Set(cnpjs.map(x=>x.slice(0,8)))]; const q1=cnpjs.map(()=>'?').join(','); const q2=raizes.map(()=>'?').join(',');
  const bases=db.prepare('SELECT cnpj,raiz,regime,ano,fonte FROM base_regime WHERE cnpj IN ('+q1+') OR raiz IN ('+q2+')').all(...cnpjs,...raizes);
  const evidencias=db.prepare("SELECT p.cnpj,e.regime,e.ano_referencia,e.fonte FROM contraparte_regime_evidencias e JOIN parceiros p ON p.id=e.parceiro_id WHERE p.empresa_id=? AND p.tipo='fornecedor'").all(Number(empresaId));
  const anuais=[...bases.map(x=>referenciaAnualAnterior(x.cnpj||x.raiz,x.regime,x.ano,x.fonte||'Base RFB')),...evidencias.filter(x=>Number(x.ano_referencia)>0).map(x=>historicoDoAno(x.cnpj,x.regime,x.ano_referencia,x.fonte||'Evidência cadastral'))];
  return [...persistidos,...compartilhados,...cadastrosCanonicos,...anuais];
}
async function listar(db,empresaId){
  const execucao=execucaoDaFotografiaOficial(db,empresaId);
  if(!execucao)return {execucao_id:null,resumo:{total:0,atual:0,divergente:0,sem_historico:0},itens:[]};
  // A auditoria deve usar a mesma precedência do motor. Comparar a fotografia
  // com uma resolução diferente criava falsos "divergentes" para documentos
  // cuja decisão fiscal ou regra Questor já havia definido o regime.
  const itens=db.prepare("WITH regime_questor AS (SELECT mq.id,br.regime,ROW_NUMBER() OVER (PARTITION BY mq.id ORDER BY CASE WHEN br.cnpj=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mq.inscr_federal,''),'.',''),'/',''),'-',''),' ','') THEN 0 ELSE 1 END,br.ano DESC) AS posicao FROM movimentos mq JOIN base_regime br ON br.cnpj=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mq.inscr_federal,''),'.',''),'/',''),'-',''),' ','') OR br.raiz=SUBSTR(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mq.inscr_federal,''),'.',''),'/',''),'-',''),' ',''),1,8) WHERE mq.empresa_id=? AND mq.tipo='fornecedor' AND UPPER(COALESCE(mq.origem,'')) IN ('QUESTOR_RAZAO','QUESTOR_CONCILIACAO_ENTRADA')) SELECT m.id movimento_id,m.inscr_federal cnpj,m.nome fornecedor,m.valor,m.documento,m.competencia,m.data_emissao,COALESCE(NULLIF(json_extract(CASE WHEN json_valid(COALESCE(r.detalhe,'')) THEN r.detalhe ELSE '{}' END,'$.regimeEmitente'),''),r.regime_cbs_emitente,m.regime) regime_fotografia,m.regime_parceiro_versao versao_fotografia,COALESCE(d.valor,q.regime,p.regime,m.regime,CASE WHEN json_valid(COALESCE(m.normalizacao_evidencia,'')) THEN json_extract(m.normalizacao_evidencia,'$.fornecedor_vinculado.regime') END) regime_cadastro,COALESCE(p.descricao,m.nome) nome_cadastro FROM motor_resultados r JOIN movimentos m ON m.id=r.movimento_id LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ','')=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','') LEFT JOIN regime_questor q ON q.id=m.id AND q.posicao=1 LEFT JOIN movimento_decisoes_fiscais d ON d.empresa_id=m.empresa_id AND d.movimento_id=m.id AND d.campo='REGIME_FORNECEDOR' AND d.revogado_em IS NULL WHERE r.empresa_id=? AND r.execucao_id=? AND r.sentido='entrada' AND LENGTH(REPLACE(REPLACE(REPLACE(m.inscr_federal,'.',''),'/',''),'-',''))=14 ORDER BY m.competencia,m.id").all(Number(empresaId),Number(empresaId),Number(execucao.id));
  const cnpjs=[...new Set(itens.map(x=>digitos(x.cnpj)))]; const porCnpj=new Map();
  const fontes=await registrosDisponiveis(db,empresaId,cnpjs); const raizesCanonicas=new Set(fontes.filter((r)=>r.canonica && !regimeGenerico(r.regime)).map((r)=>digitos(r.raiz)||digitos(r.cnpj).slice(0,8))); for(const r of fontes){const k=digitos(r.cnpj); const raiz=digitos(r.raiz)||k.slice(0,8); if(!r.canonica && raizesCanonicas.has(raiz))continue; if(!porCnpj.has(k))porCnpj.set(k,[]); porCnpj.get(k).push(r); if(raiz.length===8)for(const c of cnpjs)if(c.startsWith(raiz)){if(!porCnpj.has(c))porCnpj.set(c,[]); if(c!==k)porCnpj.get(c).push({...r,cnpj:c});}}
  const auditados=itens.map(x=>{
    const parte=String(x.data_emissao||x.competencia||'').slice(0,7);
    const dataDocumento=/^\d{4}-\d{2}$/.test(parte)?parte+'-01':parte;
    const regimeCadastro=String(x.regime_cadastro||'').trim();
    // O motor só recebe documento com parceiro resolvido — real ou genérico.
    // Reutilizamos a mesma resolução canônica, sem nova inferência de CNPJ.
    const registrosDisponiveisParaCnpj=porCnpj.get(digitos(x.cnpj))||[];
    const cadastroCompartilhado=registrosDisponiveisParaCnpj.filter((r)=>r.canonica);
    // O CNPJ exato é soberano. A raiz só completa filiais sem cadastro próprio.
    const cadastroExato=cadastroCompartilhado.filter((r)=>r.escopo_cadastro==='CNPJ' && digitos(r.cnpj)===digitos(x.cnpj));
    const cadastroEspecifico=cadastroExato.filter((r)=>!regimeGenerico(r.regime));
    const referenciaEspecifica=registrosDisponiveisParaCnpj.filter((r)=>!r.canonica && !regimeGenerico(r.regime));
    const cadastroPorRaiz=cadastroCompartilhado.filter((r)=>r.escopo_cadastro==='RAIZ');
    // "regime_regular" de consulta cadastral é genérico. Uma evidência anual
    // específica (Real/Presumido/Imune) o refina, como já ocorre no cadastro.
    const registros=cadastroEspecifico.length ? cadastroEspecifico : (referenciaEspecifica.length ? referenciaEspecifica : (cadastroExato.length ? cadastroExato : (cadastroPorRaiz.length ? cadastroPorRaiz : (regimeCadastro ? [{cnpj:x.cnpj,regime:regimeCadastro,versao:Number(x.versao_fotografia||0),vigencia_inicio:'0000-01-01',vigencia_fim:null,fonte:'Parceiro vinculado ao documento'}] : registrosDisponiveisParaCnpj))));
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
  const gruposDivergentes=new Map();
  for(const item of auditados.filter((x)=>x.status==='DIVERGENTE')){
    const chave=digitos(item.cnpj);
    if(!gruposDivergentes.has(chave))gruposDivergentes.set(chave,{cnpj:chave,fornecedor:item.nome_cadastro||item.fornecedor||'Parceiro não identificado',regime_fotografia:new Set(),regime_vigente:new Set(),movimento_ids:[],documentos:0,valor:0});
    const grupo=gruposDivergentes.get(chave); grupo.regime_fotografia.add(item.regime_fotografia||'indeterminado'); grupo.regime_vigente.add(item.regime_vigente||'indeterminado'); grupo.movimento_ids.push(Number(item.movimento_id)); grupo.documentos++; grupo.valor+=Number(item.valor)||0;
  }
  const divergencias=[...gruposDivergentes.values()].map((x)=>({...x,regime_fotografia:[...x.regime_fotografia],regime_vigente:[...x.regime_vigente]}));
  return {execucao_id:Number(execucao.id),resumo,cobertura,divergencias,itens:auditados};
}
module.exports={listar,registrosDisponiveis};

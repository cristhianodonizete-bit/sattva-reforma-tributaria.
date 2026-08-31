const chave=(linha,nomes)=>{for(const n of nomes){const v=linha[n];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return null};
const num=v=>v===null?null:(Number.isFinite(Number(String(v).replace(',','.')))?Number(String(v).replace(',','.')):null);
const t=v=>v===null?null:String(v).trim()||null;
function normalizar(linha,{empresa_id,lote_origem_id=null,hash_lineage=null,movimento_id=null,correlacao_deterministica=false}={}){
 const v=(...n)=>chave(linha,n); const vinculo=correlacao_deterministica?movimento_id:null;
 return {empresa_id,movimento_id:vinculo,tipo_fonte:'PLANILHA_ERP',lote_origem_id,hash_lineage,
  numero_documento:t(v('Documento','documento','Número Documento','numero_documento')),serie:t(v('Série','Serie','serie')),cst_pis:t(v('CST PIS','CST_PIS','cstpis')),cst_cofins:t(v('CST Cofins','CST_COFINS','cstcofins')),
  base_pis:num(v('BC PIS','BASE PIS','base_pis')),base_cofins:num(v('BC Cofins','BASE Cofins','base_cofins')),aliquota_pis:num(v('ALIQ PIS','ALIQUOTA PIS','aliquota_pis')),aliquota_cofins:num(v('ALIQ Cofins','ALIQUOTA Cofins','aliquota_cofins')),
  pis_documentado:num(v('PIS','Valor PIS','valor_pis')),cofins_documentada:num(v('COFINS','Valor Cofins','valor_cofins')),natureza_credito:t(v('Natureza Crédito','natureza_credito')),condicao_credito:t(v('Condição Crédito','condicao_credito')),
  origem_evidencia:'PLANILHA_ERP',status_validacao:vinculo?'PENDENTE_VALIDACAO':'SEM_VINCULO',grau_confianca:'MEDIA'};
}
module.exports={normalizar};

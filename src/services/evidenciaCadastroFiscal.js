const ativo=(r,c)=>(!r.vigencia_inicio||r.vigencia_inicio<=c)&&(!r.vigencia_fim||r.vigencia_fim>=c);
const unico=(rs)=>rs.length===1?rs[0]:null;
function normalizar({empresa_id,movimento_id,competencia,referencias=[],evidencia_documental=false}){
 if(evidencia_documental)return {status:'BLOQUEADA_POR_DOCUMENTO',evidencia:null};
 const r=unico(referencias.filter(x=>ativo(x,competencia))); if(!r)return {status:referencias.some(x=>!ativo(x,competencia))?'FORA_VIGENCIA':'CONFLITO_OU_AUSENTE',evidencia:null};
 return {status:'APLICAVEL',evidencia:{empresa_id,movimento_id,tipo_fonte:'CADASTRO_FISCAL',cst_pis:r.cst_pis||null,cst_cofins:r.cst_cofins||null,base_pis:r.base_pis??null,base_cofins:r.base_cofins??null,aliquota_pis:r.aliquota_pis??null,aliquota_cofins:r.aliquota_cofins??null,tratamento_especifico:r.tratamento_especifico||null,regime_incidencia:r.regime_incidencia||null,referencia_fiscal_empresa_item:r.id||null,vigencia_inicio:r.vigencia_inicio||null,vigencia_fim:r.vigencia_fim||null,origem_evidencia:'CADASTRO_FISCAL',status_validacao:'PENDENTE_VALIDACAO',grau_confianca:'MEDIA',hash_lineage:r.hash||null}};
}
module.exports={normalizar};

const db = require('../db');
const t=v=>String(v??'').trim();
const vigente=(r,d)=>(!r.vigencia_inicio||r.vigencia_inicio<=d)&&(!r.vigencia_fim||r.vigencia_fim>=d);
function resolver({empresa_id,tipo_origem,codigo_origem,ncm,descricao,data}) {
  // Código recebido no XML/SPED é evidência de origem, não identidade canônica.
  // A importação não pode criar nem vincular produto por código: isso exige uma
  // validação explícita (EAN/GTIN, Anvisa, catálogo mestre ou revisão humana).
  const codigo=t(codigo_origem); if(!codigo)return {status:'SEM_CODIGO',produto_empresa_id:null}; const dia=t(data||new Date().toISOString().slice(0,10)).slice(0,10);
  const aliases=db.prepare('SELECT a.*,p.ncm_atual,p.descricao_atual FROM produto_aliases a JOIN produtos_empresa p ON p.id=a.produto_empresa_id WHERE a.empresa_id=? AND a.tipo_origem=? AND a.codigo_origem=?').all(empresa_id,t(tipo_origem),codigo).filter(x=>vigente(x,dia));
  if(aliases.length>1)return {status:'CONFLITO_IDENTIDADE_PRODUTO',produto_empresa_id:null,aliases:aliases.map(x=>x.produto_empresa_id)};
  if(aliases.length===1){const a=aliases[0];if(t(ncm)&&t(a.ncm_atual)&&t(ncm)!==t(a.ncm_atual)) return {status:'CONFLITO_NCM_PRODUTO',produto_empresa_id:null,alias_produto_empresa_id:a.produto_empresa_id,ncm_documento:t(ncm),ncm_cadastro:t(a.ncm_atual)};return {status:'ALIAS_SEM_VALIDACAO_CANONICA',produto_empresa_id:null,alias_produto_empresa_id:a.produto_empresa_id};}
  return {status:'AGUARDANDO_IDENTIDADE_CANONICA',produto_empresa_id:null,codigo_origem:codigo};
}
module.exports={resolver};

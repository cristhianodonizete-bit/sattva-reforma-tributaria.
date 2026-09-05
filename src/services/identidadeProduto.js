const db = require('../db');
const t=v=>String(v??'').trim();
const vigente=(r,d)=>(!r.vigencia_inicio||r.vigencia_inicio<=d)&&(!r.vigencia_fim||r.vigencia_fim>=d);
function resolver({empresa_id,tipo_origem,codigo_origem,ncm,descricao,data}) {
  const codigo=t(codigo_origem); if(!codigo)return {status:'SEM_CODIGO',produto_empresa_id:null}; const dia=t(data||new Date().toISOString().slice(0,10)).slice(0,10);
  const aliases=db.prepare('SELECT a.*,p.ncm_atual,p.descricao_atual FROM produto_aliases a JOIN produtos_empresa p ON p.id=a.produto_empresa_id WHERE a.empresa_id=? AND a.tipo_origem=? AND a.codigo_origem=?').all(empresa_id,t(tipo_origem),codigo).filter(x=>vigente(x,dia));
  if(aliases.length>1)return {status:'CONFLITO_IDENTIDADE_PRODUTO',produto_empresa_id:null,aliases:aliases.map(x=>x.produto_empresa_id)};
  if(aliases.length===1){const a=aliases[0];if(t(ncm)&&t(a.ncm_atual)&&t(ncm)!==t(a.ncm_atual)) return {status:'CONFLITO_NCM_PRODUTO',produto_empresa_id:a.produto_empresa_id,ncm_documento:t(ncm),ncm_cadastro:t(a.ncm_atual)};return {status:'RESOLVIDO_ALIAS',produto_empresa_id:a.produto_empresa_id};}
  const existente=db.prepare('SELECT * FROM produtos_empresa WHERE empresa_id=? AND codigo_produto_atual=?').get(empresa_id,codigo);
  if(existente){db.prepare('INSERT OR IGNORE INTO produto_aliases (produto_empresa_id,empresa_id,tipo_origem,codigo_origem) VALUES (?,?,?,?)').run(existente.id,empresa_id,t(tipo_origem),codigo);return {status:'RESOLVIDO_CODIGO_ATUAL',produto_empresa_id:existente.id};}
  const id=db.prepare('INSERT INTO produtos_empresa (empresa_id,codigo_produto_atual,ncm_atual,descricao_atual) VALUES (?,?,?,?)').run(empresa_id,codigo,t(ncm)||null,t(descricao)||null).lastInsertRowid;
  db.prepare('INSERT INTO produto_aliases (produto_empresa_id,empresa_id,tipo_origem,codigo_origem) VALUES (?,?,?,?)').run(id,empresa_id,t(tipo_origem),codigo);
  return {status:'CRIADO_SEM_FATO_FISCAL',produto_empresa_id:Number(id)};
}
module.exports={resolver};

const dbPadrao = require('../db');
const { qsaEmpresa } = require('./elegibilidadeAnexoXi');

const texto = (v) => String(v || '').trim();
const chave = (v) => texto(v).replace(/\D/g, '');
const valor = (v) => Number(v) || 0;
const unico = (itens) => [...new Set(itens.filter(Boolean))];
const PALAVRAS_IGNORADAS = new Set(['atividade','atividades','comercio','comercial','servico','servicos','outros','outras','geral','gerais','empresa','empresas','produtos','produto','mercadoria','mercadorias','industrial','industria','nacional','nacionais','para','com','sem','por','das','dos','des','que','uma','entre']);
const termos = (v) => unico(texto(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((x) => x.length >= 5 && !PALAVRAS_IGNORADAS.has(x)));
const pontuar = (atividade, descricao) => {
  const origem = termos(atividade); const alvo = new Set(termos(descricao));
  return origem.filter((x) => alvo.has(x)).length;
};

function cnaes(empresa) {
  let secundarios = [];
  try { secundarios = JSON.parse(empresa.cnaes_secundarios || '[]'); } catch (_) { secundarios = []; }
  return [{ codigo:texto(empresa.cnae), descricao:texto(empresa.atividade), tipo:'PRINCIPAL' }, ...secundarios.map((x) => ({ codigo:texto(x.codigo || x.cnae), descricao:texto(x.descricao || x.texto), tipo:'SECUNDARIO' }))]
    .filter((x) => x.codigo || x.descricao);
}

function pisCofins(regra) {
  const itens = [];
  const tratamento=texto(regra.tratamento_pis_cofins).toUpperCase();
  const cumulativaObrigatoria=texto(regra.cumulatividade_obrigatoria).toUpperCase();
  if (cumulativaObrigatoria && !['NAO','NÃO','0','FALSE'].includes(cumulativaObrigatoria)) {
    itens.push('Cumulatividade obrigatória — prevalece sobre o regime geral da empresa.');
  } else if (!tratamento || ['NORMAL', 'TRIBUTADA_INTEGRALMENTE'].includes(tratamento)) {
    itens.push('Normal — aplicar o regime geral da empresa.');
  } else itens.push(`PIS/Cofins: ${texto(regra.tratamento_pis_cofins)}`);
  if (valor(regra.pis_percentual) || valor(regra.cofins_percentual)) itens.push(`PIS ${valor(regra.pis_percentual).toLocaleString('pt-BR')}% · Cofins ${valor(regra.cofins_percentual).toLocaleString('pt-BR')}%${cumulativaObrigatoria && !['NAO','NÃO','0','FALSE'].includes(cumulativaObrigatoria) ? ', independentemente do regime geral.' : ''}`);
  return itens;
}
function quando(regra) {
  return unico([
    texto(regra.papel_na_cadeia_necessario) && texto(regra.papel_na_cadeia_necessario).toUpperCase() !== 'NÃO' ? `Papel na cadeia: ${texto(regra.papel_na_cadeia_necessario)}` : '',
    texto(regra.condicao_cumulatividade) ? texto(regra.condicao_cumulatividade) : '',
    texto(regra.regime_pis_cofins_receita) ? `Regime PIS/Cofins: ${texto(regra.regime_pis_cofins_receita)}` : '',
    texto(regra.regra_precedencia) ? texto(regra.regra_precedencia) : '',
  ]);
}
function catalogoNcm(db, ncm) { return db.prepare('SELECT * FROM base_ncm WHERE ncm=? ORDER BY id DESC').get(chave(ncm)) || null; }
function catalogoServico(db, nbs, lc116) {
  const porNbs = chave(nbs); const porLc = texto(lc116);
  return db.prepare('SELECT * FROM base_servicos WHERE (nbs<>\'\' AND nbs=?) OR (lc116<>\'\' AND lc116=?) ORDER BY id DESC').get(porNbs, porLc) || null;
}
function operacaoEsperada(item, regra) {
  const direcao=texto(regra.direcao).toUpperCase(); const tipo=texto(regra.tipo_operacao || regra.operacao_pis_cofins);
  if (direcao) return `${direcao} — ${tipo || (item.tipo==='SERVIÇO' ? 'prestação do serviço' : 'venda da mercadoria')}`;
  if (item.tipo==='SERVIÇO') return `SAÍDA — prestação do serviço${texto(regra.onerosa) ? ` · operação onerosa: ${texto(regra.onerosa)}` : ''}${texto(regra.exterior) ? ` · exterior: ${texto(regra.exterior)}` : ''}`;
  return `SAÍDA — venda da mercadoria${texto(regra.papel_na_cadeia_necessario) ? ` · papel na cadeia: ${texto(regra.papel_na_cadeia_necessario)}` : ''}`;
}
function condicaoCbs(regra, empresaId, item) {
  const codigo=texto(regra.cclasstrib);
  if (codigo==='200044') {
    const qsa=qsaEmpresa(empresaId);
    return { texto:'Emitente com sócio brasileiro e participação de, no mínimo, 20% do capital social.', status:qsa.status, detalhe:qsa.motivo };
  }
  if (codigo==='200043') return { texto:'Destinatário deve ser ente público elegível (administração direta, autarquia ou fundação pública).', status:'PENDENTE', detalhe:'Confirmar natureza jurídica do destinatário na operação.' };
  const condicoes=unico([texto(regra.condicoes_obrigatorias), texto(regra.condicoes), texto(regra.direcao) ? `Operação: ${texto(regra.direcao)}` : '', texto(regra.perfil_adquirente) ? `Destinatário: ${texto(regra.perfil_adquirente)}` : '']);
  return { texto:condicoes.join(' · ') || 'Sem fato condicional adicional identificado na regra catalogada.', status:condicoes.length ? 'PENDENTE' : 'NAO_APLICAVEL', detalhe:'' };
}
function hipotesesCbs(db, empresaId, item) {
  const base = item.tipo==='NCM'
    ? db.prepare('SELECT * FROM base_ncm WHERE ncm=? ORDER BY cclasstrib').all(chave(item.ncm))
    : db.prepare('SELECT * FROM base_servicos WHERE (nbs<>\'\' AND nbs=?) OR (lc116<>\'\' AND lc116=?) ORDER BY cclasstrib').all(chave(item.nbs),texto(item.lc116));
  const regras = item.tipo==='NCM'
    ? db.prepare("SELECT * FROM regras_enquadramento WHERE status='ATIVA' AND ncm=? ORDER BY prioridade DESC").all(chave(item.ncm))
    : db.prepare("SELECT * FROM regras_enquadramento WHERE status='ATIVA' AND ((nbs<>'' AND nbs=?) OR (lc116<>'' AND lc116=?)) ORDER BY prioridade DESC").all(chave(item.nbs),texto(item.lc116));
  const candidatos=[...base,...regras].filter((x)=>texto(x.cclasstrib)); const vistos=new Set();
  return candidatos.filter((x)=>{ const id=texto(x.cclasstrib); if(vistos.has(id)) return false; vistos.add(id); return true; }).map((x)=>{
    const condicao=condicaoCbs(x,empresaId,item); const reducao=item.tipo==='NCM' ? (x.reducao_cbs ?? x.reducao ?? 'integral') : (x.reducao ?? 'integral');
    return { cclasstrib:texto(x.cclasstrib), cst:texto(x.cst) || texto(x.cclasstrib).slice(0,3), descricao:texto(x.classificacao || x.nome_cclasstrib || x.tratamento_resultante), reducao:String(reducao), operacao:operacaoEsperada(item,x), condicao };
  });
}
function itemProduto(db, item, empresaId) {
  const regra = catalogoNcm(db, item.ncm);
  return { tipo:'NCM', codigo:chave(item.ncm), descricao:texto(item.descricao) || texto(regra?.descricao), origem:item.origem,
    evidencia:item.evidencia, regra_encontrada:Boolean(regra), pis_cofins:regra ? pisCofins(regra) : [], hipoteses_cbs:hipotesesCbs(db,empresaId,{ tipo:'NCM', ncm:item.ncm }), quando_aplica:regra ? quando(regra) : [],
    tratamento_atual:regra?.tratamento_pis_cofins || null, cclasstrib:regra?.cclasstrib || null, fundamento:regra?.fundamento || regra?.fonte || null };
}
function itemServico(db, item, empresaId) {
  const regra = catalogoServico(db, item.nbs, item.lc116);
  return { tipo:'SERVIÇO', codigo:chave(item.nbs) || texto(item.lc116), nbs:chave(item.nbs), lc116:texto(item.lc116), descricao:texto(item.descricao) || texto(regra?.descricao_item) || texto(regra?.descricao_nbs), origem:item.origem,
    evidencia:item.evidencia, regra_encontrada:Boolean(regra), pis_cofins:regra ? pisCofins(regra) : [], hipoteses_cbs:hipotesesCbs(db,empresaId,{ tipo:'SERVIÇO', nbs:item.nbs, lc116:item.lc116 }), quando_aplica:regra ? quando(regra) : [],
    tratamento_atual:regra?.tratamento_pis_cofins || null, cclasstrib:regra?.cclasstrib || null, fundamento:regra?.regra_precedencia || null };
}

function correlacoesIndicativas(db, empresa) {
  const atividades = cnaes(empresa).filter((x) => x.descricao);
  const servicos = db.prepare('SELECT * FROM base_servicos WHERE TRIM(COALESCE(nbs,\'\'))<>\'\' OR TRIM(COALESCE(lc116,\'\'))<>\'\'').all();
  const produtos = db.prepare('SELECT * FROM base_ncm WHERE TRIM(COALESCE(ncm,\'\'))<>\'\'').all();
  const candidatos = [];
  for (const atividade of atividades) {
    for (const regra of servicos) {
      const pontos = pontuar(atividade.descricao, `${regra.descricao_item || ''} ${regra.descricao_nbs || ''}`);
      if (!pontos) continue;
      const item = itemServico(db, { nbs:regra.nbs, lc116:regra.lc116, descricao:regra.descricao_item || regra.descricao_nbs, origem:'CORRELACAO_CNAE_INDICATIVA', evidencia:atividade.codigo }, empresa.id);
      candidatos.push({ ...item, cnae:atividade.codigo, atividade:atividade.descricao, confianca:pontos >= 2 ? 'MEDIA' : 'BAIXA', pontos });
    }
    for (const regra of produtos) {
      const pontos = pontuar(atividade.descricao, regra.descricao || regra.classificacao || '');
      // Produto exige no mínimo dois termos em comum: um CNAE não pode
      // sozinho sugerir NCM por coincidência textual ampla.
      if (pontos < 2) continue;
      const item = itemProduto(db, { ncm:regra.ncm, descricao:regra.descricao || regra.classificacao, origem:'CORRELACAO_CNAE_INDICATIVA', evidencia:atividade.codigo }, empresa.id);
      candidatos.push({ ...item, cnae:atividade.codigo, atividade:atividade.descricao, confianca:'BAIXA', pontos });
    }
  }
  const unicos = new Map();
  for (const candidato of candidatos.sort((a,b) => b.pontos-a.pontos)) {
    const id=`${candidato.cnae}:${candidato.tipo}:${candidato.codigo}:${candidato.lc116 || ''}`;
    if (!unicos.has(id)) unicos.set(id,candidato);
  }
  return [...unicos.values()].slice(0, 40);
}

function listar(empresaId, { banco=dbPadrao } = {}) {
  const empresa = banco.prepare('SELECT id,razao_social,cnpj,cnae,atividade,cnaes_secundarios FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa) throw new Error('Empresa não encontrada.');
  const produtos = [];
  const servicos = [];
  // O cadastro comercial pode conter uma oferta ainda sem NF-e: esta é a
  // fonte segura para antecipar análise sem inventar NCM/NBS pelo CNAE.
  banco.prepare('SELECT ncm,descricao,\'CADASTRO_COMERCIAL\' origem, codigo evidencia FROM pricing_products WHERE empresa_id=? AND TRIM(COALESCE(ncm,\'\'))<>\'\'').all(empresaId)
    .forEach((x) => produtos.push(itemProduto(banco, x, empresa.id)));
  banco.prepare('SELECT nbs,lc116,descricao,\'CADASTRO_COMERCIAL\' origem, codigo evidencia FROM pricing_services WHERE empresa_id=? AND (TRIM(COALESCE(nbs,\'\'))<>\'\' OR TRIM(COALESCE(lc116,\'\'))<>\'\')').all(empresaId)
    .forEach((x) => servicos.push(itemServico(banco, x, empresa.id)));
  banco.prepare('SELECT nbs,\'\' lc116,descricao,\'CADASTRO_FISCAL\' origem,chave evidencia FROM empresa_servicos_fiscais WHERE empresa_id=? AND TRIM(COALESCE(nbs,\'\'))<>\'\' AND ativo=1').all(empresaId)
    .forEach((x) => servicos.push(itemServico(banco, x, empresa.id)));
  banco.prepare(`SELECT ncm,nbs,lc116,descricao,CASE WHEN tipo='cliente' THEN 'DOCUMENTO_DE_SAIDA' ELSE 'DOCUMENTO_DE_ENTRADA' END origem,
    COALESCE(chave,documento,CAST(id AS TEXT)) evidencia FROM movimentos WHERE empresa_id=? AND (TRIM(COALESCE(ncm,''))<>'' OR TRIM(COALESCE(nbs,''))<>'' OR TRIM(COALESCE(lc116,''))<>'')`).all(empresaId)
    .forEach((x) => { if (chave(x.ncm)) produtos.push(itemProduto(banco,x,empresa.id)); if (chave(x.nbs) || texto(x.lc116)) servicos.push(itemServico(banco,x,empresa.id)); });
  const deduplicar = (lista) => [...new Map(lista.map((x) => [`${x.tipo}:${x.codigo}:${x.lc116 || ''}`, x])).values()].sort((a,b)=>a.codigo.localeCompare(b.codigo));
  const itens = [...deduplicar(produtos), ...deduplicar(servicos)];
  const correlacoes = correlacoesIndicativas(banco, empresa);
  return { empresa, cnaes:cnaes(empresa), itens, resumo:{ itens:itens.length, produtos:deduplicar(produtos).length, servicos:deduplicar(servicos).length, com_regra:itens.filter((x)=>x.regra_encontrada).length, com_beneficio:itens.filter((x)=>x.hipoteses_cbs?.some((h)=>String(h.reducao).toLowerCase()!=='integral')).length },
    correlacoes, aviso:'O CNAE organiza o contexto econômico. As correlações são indicativas e não aplicam NCM, NBS, LC 116, benefício ou cálculo; confirme o item e os fatos da operação antes de usar qualquer regra.' };
}
module.exports = { listar };

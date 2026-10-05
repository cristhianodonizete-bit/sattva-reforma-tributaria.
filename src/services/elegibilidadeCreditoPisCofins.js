/*
 * Triagem operacional de crédito histórico de PIS/Cofins.
 *
 * Não calcula crédito, não altera a apuração e não substitui validação fiscal.
 * CNAE delimita a atividade; a conclusão só fica forte quando a entrada tem
 * vínculo objetivo com uma saída/insumo documentado. Isso materializa a
 * essencialidade/relevância sem converter similaridade textual em direito.
 */
const dbPadrao = require('../db');

const texto = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const codigo = (v) => String(v || '').replace(/\D/g, '');
const palavras = (v) => new Set(texto(v).split(/[^a-z0-9]+/).filter((x) => x.length >= 5 && !['comercio','comercial','servico','servicos','produto','produtos','empresa','mercadoria','mercadorias','gerais','outros','outras','para','sobre'].includes(x)));
const intersecao = (a,b) => [...a].filter((x) => b.has(x));
const regimeBloqueia = (regime) => ['simples_nacional','mei','lucro_presumido'].includes(String(regime || '').toLowerCase());
const termosVedados = /\b(brinde|doacao|doaçao|multa|juros|presente|confraternizacao|confraternização|socio|sócio|uso pessoal|pessoal)\b/i;

function atividades(empresa) {
  let secundarios=[]; try { secundarios=JSON.parse(empresa.cnaes_secundarios || '[]'); } catch (_) { secundarios=[]; }
  return [empresa.atividade || '', ...secundarios.map((x)=>x.descricao || x.texto || '')].filter(Boolean).join(' ');
}

function classificar(item, contexto) {
  const regime=String(contexto.regime || '').toLowerCase();
  const cfop=codigo(item.cfop);
  if (['5915','6915'].includes(cfop)) return { status:'NAO_ELEGIVEL', rotulo:'Sem crédito — remessa', motivo:`CFOP ${cfop}: remessa para conserto/reparo não representa aquisição para crédito de PIS/Cofins.`, evidencia:'CFOP do documento fiscal.' };
  if (!regime) return { status:'A_VALIDAR_REGIME', rotulo:'Validar regime', motivo:'O regime da empresa não está confirmado; não é possível concluir o aproveitamento histórico de PIS/Cofins.', evidencia:'Cadastro da empresa pendente.' };
  if (regimeBloqueia(regime)) return { status:'BLOQUEADO_REGIME', rotulo:'Não apropriável no regime', motivo:`A empresa está no regime ${regime.replace(/_/g,' ')}; esta tela não trata a carga da entrada como crédito histórico apropriável de PIS/Cofins.`, evidencia:'Regime da empresa.' };
  if (termosVedados.test(item.descricao || '')) return { status:'NAO_ELEGIVEL', rotulo:'Não elegível', motivo:'A descrição sugere despesa sem vínculo operacional direto; requer justificativa excepcional para revisão.', evidencia:'Descrição do documento.' };
  const codigoItem=codigo(item.ncm) || codigo(item.nbs) || codigo(item.lc116);
  const saidaMesmoCodigo=codigoItem && contexto.codigosSaida.has(codigoItem);
  const termosItem=palavras(item.descricao);
  const termosSaida=intersecao(termosItem,contexto.termosSaida);
  const termosAtividade=intersecao(termosItem,contexto.termosAtividade);
  if (saidaMesmoCodigo) return { status:'ELEGIVEL_COM_EVIDENCIA', rotulo:'Elegível com evidência', motivo:'A entrada possui a mesma referência fiscal de operação de saída no período analisado; revisar a destinação efetiva antes da apropriação.', evidencia:'NCM/NBS/LC 116 coincidente com saída documentada.' };
  if (termosSaida.length >= 2) return { status:'ELEGIVEL_COM_EVIDENCIA', rotulo:'Elegível com evidência', motivo:'A descrição possui vínculo textual objetivo com produtos ou serviços efetivamente vendidos; validar a destinação e a vedação específica.', evidencia:`Termos em comum com saídas: ${termosSaida.join(', ')}.` };
  if (termosAtividade.length >= 1) return { status:'CANDIDATO_VALIDAR', rotulo:'Candidato a validação', motivo:'Há aderência à atividade declarada no CNAE, mas falta vínculo documental suficiente com a operação de saída ou o processo produtivo.', evidencia:`Termos em comum com CNAE/atividade: ${termosAtividade.join(', ')}.` };
  return { status:'CANDIDATO_VALIDAR', rotulo:'Candidato a validação', motivo:'Não há evidência suficiente de essencialidade ou relevância. CNAE isolado não comprova o crédito.', evidencia:'Requer vínculo com saída, contrato, processo produtivo ou justificativa operacional.' };
}

function listar(empresaId, { banco=dbPadrao }={}) {
  const empresa=banco.prepare('SELECT id,regime,regime_resolvido,cnae,atividade,cnaes_secundarios FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa) throw new Error('Empresa não encontrada.');
  const saidas=banco.prepare("SELECT ncm,nbs,lc116,descricao FROM movimentos WHERE empresa_id=? AND (tipo='cliente' OR lower(COALESCE(sentido,''))='saida')").all(Number(empresaId));
  const codigosSaida=new Set(saidas.flatMap((x)=>[codigo(x.ncm),codigo(x.nbs),codigo(x.lc116)]).filter(Boolean));
  const termosSaida=new Set(saidas.flatMap((x)=>[...palavras(x.descricao)]));
  const termosAtividade=palavras(atividades(empresa));
  const contexto={ regime:empresa.regime_resolvido && empresa.regime_resolvido!=='indeterminado' ? empresa.regime_resolvido : empresa.regime, codigosSaida, termosSaida, termosAtividade };
  const itens=banco.prepare("SELECT id,competencia,documento,modelo_documento_fiscal,data_emissao,nome,descricao,ncm,nbs,lc116,cfop,valor FROM movimentos WHERE empresa_id=? AND tipo='fornecedor' ORDER BY competencia DESC,id DESC").all(Number(empresaId)).map((item)=>({ ...item, ...classificar(item,contexto) }));
  const porDocumento=new Map();
  const prioridade={ BLOQUEADO_REGIME:4, NAO_ELEGIVEL:3, A_VALIDAR_REGIME:3, CANDIDATO_VALIDAR:2, ELEGIVEL_COM_EVIDENCIA:1 };
  for (const item of itens) {
    const chave=`${String(item.data_emissao || item.competencia || '').slice(0,10)}|${String(item.modelo_documento_fiscal || '').toLowerCase()}|${String(item.documento || '')}`;
    const atual=porDocumento.get(chave);
    if (!atual || (prioridade[item.status] || 0) > (prioridade[atual.status] || 0)) porDocumento.set(chave,{...item,itens:1});
    else atual.itens+=1;
  }
  const resumo=itens.reduce((s,x)=>{s[x.status]=(s[x.status]||0)+1;return s;},{});
  return { empresa:{cnae:empresa.cnae||'',atividade:empresa.atividade||'',regime:contexto.regime||''}, itens, documentos:[...porDocumento.values()], resumo,
    leitura:'Triagem de essencialidade/relevância: não calcula nem apropria crédito de PIS/Cofins. CNAE é contexto, não prova isolada.' };
}

module.exports={ listar, classificar };

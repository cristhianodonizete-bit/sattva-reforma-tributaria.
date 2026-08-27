/** Saída executiva de Precificação. Consolida somente simulador e memória. */
const PDFDocument = require('pdfkit');
const pricing = require('./precificacaoIndependente');
const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;

function natureza(item) { return item.status === 'INCOMPLETO' ? 'INCOMPLETO' : item.simulacao.natureza || 'CALCULADO'; }
function recomendacoes(itens) {
  return itens.flatMap((x) => {
    const s = x.simulacao; const atual = x.margem.valor; const proj = s.margem_projetada; const nome = x.item.descricao;
    if (atual == null || proj == null) return [];
    const saida = [];
    if (proj < atual) saida.push({ item_id:x.item.id, tipo:'MARGEM_COMPRIMIDA', texto:`${nome}: o preço preservado reduz a margem em R$ ${r2(atual-proj).toFixed(2)}.`, indicador:'margem projetada', valor:proj, causa:'tributação oficial e custo formado', premissa:x.modo, natureza:natureza(x), memoria:x.waterfall });
    if (x.modo === 'PRESERVAR_MARGEM' && s.preco_projetado > s.valor_venda_atual) saida.push({ item_id:x.item.id, tipo:'REAJUSTE_NECESSARIO', texto:`${nome}: exige reajuste de ${((s.preco_projetado/s.valor_venda_atual-1)*100).toFixed(2)}% para preservar a margem.`, indicador:'preço projetado', valor:s.preco_projetado, causa:'margem econômica atual e custo formado', premissa:x.modo, natureza:natureza(x), memoria:x.waterfall });
    if (s.custo_efetivo_do_cliente != null && s.custo_efetivo_do_cliente < s.preco_projetado) saida.push({ item_id:x.item.id, tipo:'COMPETITIVIDADE_B2B', texto:`${nome}: crédito determinado reduz o custo efetivo do cliente em R$ ${r2(s.preco_projetado-s.custo_efetivo_do_cliente).toFixed(2)}.`, indicador:'custo efetivo do cliente', valor:s.custo_efetivo_do_cliente, causa:'crédito determinado pelo motor', premissa:x.modo, natureza:natureza(x), memoria:x.waterfall });
    return saida;
  });
}
function montar(empresaId, opcoes={}) {
  const itens = pricing.simularEmpresa(empresaId, opcoes).filter((x) => !opcoes.item_ids?.length || opcoes.item_ids.map(Number).includes(Number(x.item.id)));
  const completos = itens.filter(x=>x.status !== 'INCOMPLETO'); const soma=(fn)=>r2(itens.reduce((a,x)=>a+n(fn(x)),0));
  const variacoes = completos.map(x=>x.simulacao.preco_projetado-x.simulacao.valor_venda_atual);
  const margemVar = completos.filter(x=>x.margem.valor!=null&&x.simulacao.margem_projetada!=null).map(x=>x.simulacao.margem_projetada-x.margem.valor);
  const indicadores={ itens_necessidade_reajuste:itens.filter(x=>x.simulacao.preco_projetado>x.simulacao.valor_venda_atual).length, receita_margem_comprimida:soma(x=>x.simulacao.margem_projetada!=null&&x.margem.valor!=null&&x.simulacao.margem_projetada<x.margem.valor?x.simulacao.valor_venda_atual:0), receita_margem_preservada:soma(x=>x.simulacao.margem_projetada!=null&&x.margem.valor!=null&&x.simulacao.margem_projetada>=x.margem.valor?x.simulacao.valor_venda_atual:0), itens_custo_incompleto:itens.filter(x=>x.status==='INCOMPLETO').length, itens_credito_indeterminado:itens.filter(x=>x.simulacao.credito_entregue_ao_cliente==null).length, variacao_media_preco:variacoes.length?r2(variacoes.reduce((a,v)=>a+v,0)/variacoes.length):null, variacao_media_margem:margemVar.length?r2(margemVar.reduce((a,v)=>a+v,0)/margemVar.length):null, credito_recuperavel_total:soma(x=>x.waterfall.custo.creditos_recuperaveis), credito_entregue_total:soma(x=>x.simulacao.credito_entregue_ao_cliente), delta_custo_efetivo_cliente:soma(x=>x.simulacao.custo_efetivo_do_cliente==null?0:x.simulacao.custo_efetivo_do_cliente-x.simulacao.valor_venda_atual) };
  return { modo:opcoes.modo || 'REAJUSTE_LIVRE', itens, recomendacoes:recomendacoes(itens), indicadores,
    secoes:{
      resumo:indicadores,
      produtos:itens.filter(x=>x.item.natureza_item==='produto'), servicos:itens.filter(x=>x.item.natureza_item==='servico'),
      formacao_custo:itens.map(x=>({item_id:x.item.id,descricao:x.item.descricao,...x.waterfall.custo})),
      preco_atual_projetado:itens.map(x=>({item_id:x.item.id,atual:x.simulacao.valor_venda_atual,projetado:x.simulacao.preco_projetado})),
      margem_atual_projetada:itens.map(x=>({item_id:x.item.id,atual:x.simulacao.margem_atual,projetada:x.simulacao.margem_projetada,status:x.status})),
      credito_recebido:itens.map(x=>({item_id:x.item.id,valor:x.waterfall.custo.creditos_recuperaveis,natureza:natureza(x)})),
      credito_entregue:itens.map(x=>({item_id:x.item.id,valor:x.simulacao.credito_entregue_ao_cliente,natureza:natureza(x)})),
      custo_efetivo_cliente:itens.map(x=>({item_id:x.item.id,valor:x.simulacao.custo_efetivo_do_cliente,natureza:natureza(x)})),
      waterfall:itens.map(x=>({item_id:x.item.id,descricao:x.item.descricao,...x.waterfall})),
      margem_comprimida:itens.filter(x=>x.simulacao.margem_atual!=null&&x.simulacao.margem_projetada!=null&&x.simulacao.margem_projetada<x.simulacao.margem_atual),
      aumento_preco:itens.filter(x=>x.simulacao.preco_projetado>x.simulacao.valor_venda_atual),
      competitividade_b2b_afetada:itens.filter(x=>x.simulacao.custo_efetivo_do_cliente!=null),
      dados_incompletos:itens.filter(x=>x.status==='INCOMPLETO'||x.simulacao.credito_entregue_ao_cliente==null),
    }
  };
}
function gerarPdf(relatorio, res) {
  const doc = new PDFDocument({ margin:40, size:'A4' }); doc.pipe(res);
  const moeda=(v)=>v==null?'INDETERMINADO':`R$ ${n(v).toLocaleString('pt-BR',{minimumFractionDigits:2})}`;
  doc.fontSize(18).text('Precificação e Margem - Saída executiva'); doc.moveDown().fontSize(10).text(`Modo: ${relatorio.modo}`);
  doc.moveDown().fontSize(13).text('Resumo'); Object.entries(relatorio.indicadores).forEach(([k,v])=>doc.fontSize(9).text(`${k.replaceAll('_',' ')}: ${typeof v==='number'?moeda(v):v}`));
  doc.addPage().fontSize(13).text('Produtos e serviços'); relatorio.itens.forEach((x)=>{doc.fontSize(10).text(`${x.item.codigo} - ${x.item.descricao} [${natureza(x)}]`);doc.fontSize(8).text(`Preço atual ${moeda(x.simulacao.valor_venda_atual)} | projetado ${moeda(x.simulacao.preco_projetado)} | custo bruto ${moeda(x.waterfall.custo.componentes_brutos)} | créditos ${moeda(x.waterfall.custo.creditos_recuperaveis)} | custo líquido ${moeda(x.custos.custo_formado)} | margem ${moeda(x.simulacao.margem_projetada)} | IBS ${moeda(x.simulacao.ibs)} | CBS ${moeda(x.simulacao.cbs)} | crédito cliente ${moeda(x.simulacao.credito_entregue_ao_cliente)} | custo efetivo ${moeda(x.simulacao.custo_efetivo_do_cliente)}`);doc.moveDown(.4);});
  doc.addPage().fontSize(13).text('Recomendações com evidência'); (relatorio.recomendacoes.length?relatorio.recomendacoes:[{texto:'Nenhuma recomendação conclusiva: faltam condições objetivas ou não houve variação material.'}]).forEach(x=>{doc.fontSize(9).text(x.texto); if(x.causa) doc.fontSize(8).text(`Causa: ${x.causa} | Premissa: ${x.premissa} | Natureza: ${x.natureza}`);doc.moveDown(.5);});
  doc.fontSize(8).text('A memória detalhada permanece disponível na aplicação por item.'); doc.end();
}
module.exports={montar,gerarPdf};

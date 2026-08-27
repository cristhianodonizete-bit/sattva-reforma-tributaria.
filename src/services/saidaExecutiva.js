/**
 * SAÍDA EXECUTIVA DO DIAGNÓSTICO
 *
 * Esta camada só organiza fatos já produzidos pelo cenário/motor oficial.
 * Não chama calculadora, não reconstrói base e não interpreta ausência como
 * zero. Todo bloco devolve a sua natureza e o alvo de memória que o sustenta.
 */
const PDFDocument = require('pdfkit');
const db = require('../db');
const analiseCadeia = require('./analiseCadeia');

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const brl = (v) => v === null || v === undefined ? 'INCOMPLETO' : n(v).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const pct = (v) => v === null || v === undefined ? 'INDETERMINADO' : `${(n(v) * 100).toFixed(2).replace('.', ',')}%`;

function naturezaResultado(r) { return r.eBase ? 'CALCULADO' : 'SIMULADO'; }
function statusFinanceiro(v) { return v === null || v === undefined ? 'INCOMPLETO' : 'CALCULADO'; }
function memoria(lado, dimensao, grupos) { return { lado, dimensao, grupos }; }

function premissasDoCenario(cenarioId) {
  if (!cenarioId) return [];
  const ps = db.prepare(`SELECT nivel,lado,dimensao,grupo,entidade_tipo,entidade_id,campo,
      valor_original,valor_simulado,justificativa,fonte,natureza
    FROM cenario_premissas WHERE cenario_id=? ORDER BY nivel,campo,id`).all(cenarioId);
  const al = db.prepare(`SELECT lado,dimensao,grupo_origem,grupo_destino,percentual_grupo,
      variacao_preco,justificativa FROM cenario_alocacoes WHERE cenario_id=? ORDER BY id`).all(cenarioId);
  return [
    ...ps.map((p) => ({ tipo:'PREMISSA', ...p, natureza:p.natureza || 'SIMULADO' })),
    ...al.map((a) => ({ tipo:'MIGRACAO', ...a, natureza:'SIMULADO' })),
  ];
}

function fotografia(resultado) {
  const i = resultado.indicadores || {};
  const a = resultado.apuracao || {};
  const cbs = a.cbs || {};
  const ibs = a.ibs || {};
  const natureza = naturezaResultado(resultado);
  return {
    id: resultado.cenario.id, nome: resultado.cenario.nome, tipo: resultado.cenario.tipo,
    ano: resultado.ano, natureza,
    receita: r2(i.receita), receitaProjetada:r2(i.receitaProjetada), compras:r2(i.compras),
    comprasProjetadas:r2(i.comprasProjetadas), baseEconomicaSaidas:r2(i.baseEconomicaSaidas),
    baseEconomicaEntradas:r2(i.baseEconomicaEntradas), cbsDebito:r2(cbs.debitos),
    cbsCredito:r2(cbs.creditos), cbsLiquida:r2(cbs.liquido), ibsDebito:r2(ibs.debitos),
    ibsCredito:r2(ibs.creditos), ibsLiquida:r2(ibs.liquido), creditoRecebido:r2(i.creditoRecebido),
    creditoEntregue:r2(i.creditoEntregue), custoEfetivo:r2(i.custoEfetivoCompras),
    margem:i.margem ?? null, coberturaMargem:n(i.coberturaMargem), caixa:i.caixaOperacional ?? null,
    statusCaixa:i.statusCaixa || statusFinanceiro(i.caixaOperacional),
    operacoesCompras:(resultado.entradas || []).length, operacoesVendas:(resultado.saidas || []).length,
    memoriaVendas:memoria('vendas','perfil_cliente',['b2b_credito','b2b_sem_credito','b2c_pf','b2c_pj','governo','indeterminado']),
    memoriaCompras:memoria('compras','credito_fornecedor',['normal','limitado','simples','presumido','sem_credito','indeterminado']),
  };
}

function comparacao(base, cenarios) {
  return cenarios.map((c) => ({
    cenario:c.nome, id:c.id, natureza:c.natureza,
    receitaProjetada:c.receitaProjetada, cbsLiquida:c.cbsLiquida, creditoRecebido:c.creditoRecebido,
    creditoEntregue:c.creditoEntregue, custoEfetivo:c.custoEfetivo, margem:c.margem, caixa:c.caixa,
    deltaReceita:r2(c.receitaProjetada - base.receitaProjetada), deltaCbsLiquida:r2(c.cbsLiquida - base.cbsLiquida),
    deltaCreditoRecebido:r2(c.creditoRecebido - base.creditoRecebido), deltaCustoEfetivo:r2(c.custoEfetivo - base.custoEfetivo),
    deltaMargem:c.margem === null || base.margem === null ? null : r2(c.margem - base.margem),
    deltaCaixa:c.caixa === null || base.caixa === null ? null : r2(c.caixa - base.caixa),
  }));
}

function limitacoes(resultado, analise) {
  const i = resultado.indicadores || {};
  const out = [];
  if (n(analise.indicadores.exposicao_credito_indeterminado?.percentual) > 0) {
    out.push({ natureza:'INDETERMINADO', texto:`${pct(analise.indicadores.exposicao_credito_indeterminado.percentual)} das compras possuem crédito CBS indeterminado; este valor não foi convertido em zero.`, memoria:analise.indicadores.exposicao_credito_indeterminado.drilldown });
  }
  if (n(i.coberturaMargem) < 1) out.push({ natureza:'INCOMPLETO', texto:`Margem disponível para ${pct(i.coberturaMargem)} das saídas com formação de custo completa. As demais saídas não recebem margem estimada.`, memoria:null });
  if (i.caixaOperacional === null || i.caixaOperacional === undefined) out.push({ natureza:'INCOMPLETO', texto:'Caixa operacional não é exibido: faltam vínculos completos de formação de custo. Não foi criado valor estimado.', memoria:null });
  if (n(analise.indicadores.cobertura_cadastral_clientes?.percentual) < 1) out.push({ natureza:'INDETERMINADO', texto:`Cobertura cadastral de clientes: ${pct(analise.indicadores.cobertura_cadastral_clientes.percentual)}. A parcela desconhecida permanece explícita.`, memoria:analise.indicadores.cobertura_cadastral_clientes.drilldown });
  return out;
}

function montar(resultados) {
  if (!resultados?.length) throw new Error('Selecione ao menos o cenário base.');
  const baseResultado = resultados.find((r) => r.eBase || r.cenario.tipo === 'base') || resultados[0];
  const base = fotografia(baseResultado);
  const fotos = resultados.map(fotografia);
  const analises = resultados.map((r) => ({ id:r.cenario.id, analise:analiseCadeia.analisar(r) }));
  const prim = analises.find((x) => x.id === base.id)?.analise || analises[0].analise;
  const cenarios = fotos.filter((x) => x.id !== base.id);
  const principal = resultados.find((r) => r.cenario.id !== base.id) || baseResultado;
  const efeitos = principal.efeitos?.compras || null;
  const alertas = analises.flatMap((x) => x.analise.alertas.map((a) => ({ ...a, cenario_id:x.id,
    memoria:a.drilldown ? { ...a.drilldown, cenarioId:x.id } : null })));
  const oportunidades = alertas.filter((a) => a.severidade === 'bom').map((a) => ({ titulo:a.titulo, texto:a.texto, evidencia:a.evidencia, memoria:a.drilldown, natureza:a.natureza }));
  const atencoes = alertas.filter((a) => a.severidade !== 'bom').map((a) => ({ titulo:a.titulo, texto:a.texto, evidencia:a.evidencia, memoria:a.drilldown, natureza:a.natureza }));
  return {
    titulo:'Implementação da Reforma Tributária', subtitulo:'Diagnóstico executivo CBS', geradoEm:new Date().toISOString(),
    fonte:'motor_resultados via cenários, indicadores, alertas, matriz e memória de cálculo',
    base, cenarios, comparacao:comparacao(base, fotos),
    secoes:{
      resumoExecutivo:{ natureza:'CALCULADO', fatos:[
        { rotulo:'CBS líquida projetada', valor:base.cbsLiquida, natureza:base.natureza, memoria:base.memoriaVendas },
        { rotulo:'Crédito CBS recebido', valor:base.creditoRecebido, natureza:base.natureza, memoria:base.memoriaCompras },
        { rotulo:'Crédito CBS entregue', valor:base.creditoEntregue, natureza:base.natureza, memoria:base.memoriaVendas },
      ] },
      qualidade:{ natureza:'CALCULADO', indicadores:[
        prim.indicadores.cobertura_cadastral_clientes, prim.indicadores.cobertura_cadastral_fornecedores,
        prim.indicadores.exposicao_credito_indeterminado,
      ] },
      compras:{ natureza:base.natureza, valor:base.compras, baseEconomica:base.baseEconomicaEntradas, cbs:base.cbsCredito, credito:base.creditoRecebido, memoria:base.memoriaCompras },
      vendas:{ natureza:base.natureza, valor:base.receita, baseEconomica:base.baseEconomicaSaidas, cbs:base.cbsDebito, precoProjetado:base.receitaProjetada, creditoEntregue:base.creditoEntregue, memoria:base.memoriaVendas },
      waterfall: efeitos ? { natureza:principal.eBase ? 'CALCULADO' : 'SIMULADO', ...efeitos } : null,
      matriz:prim.matriz, alertas, oportunidades, atencoes,
      premissas: resultados.flatMap((r) => premissasDoCenario(r.cenario.id).map((p) => ({ cenario:r.cenario.nome, ...p }))),
      limitacoes: resultados.flatMap((r) => limitacoes(r, analiseCadeia.analisar(r)).map((x) => ({ cenario:r.cenario.nome,
        ...x, memoria:x.memoria ? { ...x.memoria, cenarioId:r.cenario.id } : null }))),
      metodologia:{ natureza:'CALCULADO', texto:'Os valores são consolidados a partir de motor_resultados por meio do cenário base e dos cenários selecionados. O caminho de auditoria permanece disponível até grupo, parceiro, documento, item, classificação, regra, premissa, fórmula e resultado.' },
    },
  };
}

function textoSeguro(v) { return String(v ?? '').replace(/[\u2013\u2014]/g, '-').replace(/•/g, '-'); }
function gerarPdf(relatorio, destino) {
  const doc = new PDFDocument({ size:'A4', margin:42, info:{ Title:'Diagnóstico executivo CBS - Sattva' } });
  doc.pipe(destino);
  const titulo = (t) => { doc.moveDown(.55); doc.font('Helvetica-Bold').fontSize(17).fillColor('#07395A').text(textoSeguro(t)); doc.moveDown(.35); };
  const linha = (r, ntr='CALCULADO') => { doc.font('Helvetica-Bold').fontSize(9).fillColor('#07395A').text(textoSeguro(r)); doc.font('Helvetica').fontSize(9).fillColor('#263745').text(`${textoSeguro(ntr)} | ${textoSeguro(typeof r === 'object' ? JSON.stringify(r) : '')}`); };
  const fato = (rotulo, valor, natureza) => { doc.font('Helvetica-Bold').fontSize(10).fillColor('#07395A').text(textoSeguro(rotulo)); doc.font('Helvetica').fontSize(12).fillColor('#111827').text(`${brl(valor)} | ${textoSeguro(natureza)}`); doc.moveDown(.2); };
  doc.font('Helvetica-Bold').fontSize(25).fillColor('#07395A').text('Sattva');
  doc.fontSize(19).text('Implementação da Reforma Tributária'); doc.moveDown(1);
  doc.font('Helvetica').fontSize(12).fillColor('#263745').text('Diagnóstico executivo CBS');
  doc.text(`Cenário base: ${textoSeguro(relatorio.base.nome)}`);
  doc.text(`Gerado em: ${new Date(relatorio.geradoEm).toLocaleString('pt-BR')}`);
  doc.moveDown(1); doc.fontSize(9).fillColor('#5d6b78').text('Todos os números são derivados dos resultados oficiais e podem ser auditados na memória de cálculo.');
  titulo('1. Resumo executivo'); relatorio.secoes.resumoExecutivo.fatos.forEach((x) => fato(x.rotulo, x.valor, x.natureza));
  titulo('2. Qualidade e cobertura dos dados'); relatorio.secoes.qualidade.indicadores.forEach((x) => linha(`${x.nome}: ${pct(x.percentual)}`, x.percentual === null ? 'INDETERMINADO' : 'CALCULADO'));
  titulo('3. Cenário base'); fato('Receita atual', relatorio.base.receita, relatorio.base.natureza); fato('Base econômica das saídas', relatorio.base.baseEconomicaSaidas, relatorio.base.natureza); fato('CBS líquida projetada', relatorio.base.cbsLiquida, relatorio.base.natureza);
  titulo('4. Impacto nas compras'); const cp=relatorio.secoes.compras; fato('Compras atuais',cp.valor,cp.natureza); fato('Base econômica das entradas',cp.baseEconomica,cp.natureza); fato('Crédito CBS recebido',cp.credito,cp.natureza);
  titulo('5. Impacto nas vendas'); const vd=relatorio.secoes.vendas; fato('Vendas atuais',vd.valor,vd.natureza); fato('CBS das vendas',vd.cbs,vd.natureza); fato('Venda projetada',vd.precoProjetado,vd.natureza);
  titulo('6. Crédito recebido e crédito entregue'); fato('Recebido de fornecedores',relatorio.base.creditoRecebido,relatorio.base.natureza); fato('Entregue aos clientes',relatorio.base.creditoEntregue,relatorio.base.natureza);
  titulo('7. Waterfall econômico'); if (relatorio.secoes.waterfall) Object.entries(relatorio.secoes.waterfall).filter(([,v]) => typeof v === 'number').forEach(([k,v]) => fato(k,v,relatorio.secoes.waterfall.natureza)); else doc.fontSize(10).text('Sem hipótese adicional selecionada; o cenário base não cria waterfall de variação.');
  titulo('8. Comparação Base x Cenário(s)'); relatorio.comparacao.forEach((x) => { doc.font('Helvetica-Bold').fontSize(11).fillColor('#07395A').text(textoSeguro(x.cenario)); doc.font('Helvetica').fontSize(9).fillColor('#263745').text(`CBS líquida ${brl(x.cbsLiquida)} | Delta ${brl(x.deltaCbsLiquida)} | Crédito recebido ${brl(x.creditoRecebido)} | Custo efetivo ${brl(x.custoEfetivo)} | ${x.natureza}`); doc.moveDown(.25); });
  titulo('9. Matriz Fornecedores x Clientes'); doc.font('Helvetica').fontSize(9).fillColor('#263745').text(textoSeguro(relatorio.secoes.matriz.observacao)); relatorio.secoes.matriz.linhas.forEach((l) => { doc.moveDown(.25); doc.font('Helvetica-Bold').text(textoSeguro(l.nome)); doc.font('Helvetica').text(l.celulas.map((c) => `${c.horizontal}: ${brl(c.exposicaoEconomica)}`).join(' | ')); });
  titulo('10. Principais alertas'); if (relatorio.secoes.alertas.length) relatorio.secoes.alertas.forEach((a) => { doc.font('Helvetica-Bold').fontSize(10).text(textoSeguro(a.titulo)); doc.font('Helvetica').fontSize(9).text(textoSeguro(a.texto)); doc.moveDown(.25); }); else doc.fontSize(10).text('Nenhum limiar de alerta foi atingido.');
  titulo('11. Oportunidades e pontos de atenção'); [...relatorio.secoes.oportunidades,...relatorio.secoes.atencoes].forEach((a) => { doc.font('Helvetica-Bold').fontSize(10).text(textoSeguro(a.titulo)); doc.font('Helvetica').fontSize(9).text(textoSeguro(a.texto)); doc.moveDown(.2); });
  titulo('12. Premissas utilizadas'); if(relatorio.secoes.premissas.length) relatorio.secoes.premissas.forEach((p) => doc.font('Helvetica').fontSize(9).text(textoSeguro(`${p.cenario}: ${p.tipo} ${p.campo || `${p.grupo_origem} -> ${p.grupo_destino}`} | ${p.valor_simulado || pct(p.percentual_grupo)} | ${p.natureza}`))); else doc.fontSize(10).text('Não há premissas simuladas no cenário base.');
  titulo('13. Limitações e dados indeterminados'); if(relatorio.secoes.limitacoes.length) relatorio.secoes.limitacoes.forEach((x) => doc.font('Helvetica').fontSize(9).text(textoSeguro(`${x.cenario}: ${x.natureza} - ${x.texto}`))); else doc.fontSize(10).text('Nenhuma limitação adicional identificada na fotografia selecionada.');
  titulo('14. Memória e resumo metodológico'); doc.font('Helvetica').fontSize(10).text(textoSeguro(relatorio.secoes.metodologia.texto));
  doc.end(); return doc;
}

module.exports = { montar, gerarPdf, fotografia, premissasDoCenario };

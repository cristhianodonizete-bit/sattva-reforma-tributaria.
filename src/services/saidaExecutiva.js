/**
 * SAÍDA EXECUTIVA DO DIAGNÓSTICO
 *
 * Esta camada só organiza fatos já produzidos pelo cenário/motor oficial.
 * Não chama calculadora, não reconstrói base e não interpreta ausência como
 * zero. Todo bloco devolve a sua natureza e o alvo de memória que o sustenta.
 */
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');
const db = require('../db');
const analiseCadeia = require('./analiseCadeia');
const perfilTributarioHistorico = require('./perfilTributarioHistorico');
const conformidadeDocumental = require('./conformidadeDocumental');

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

function contextoEmpresa(empresaId) {
  if (!empresaId) return { empresa:null, perfil:null, conformidade:null, planejamento:null };
  const empresa = db.prepare('SELECT id,razao_social,nome_fantasia,cnpj,cnae,atividade,cnaes_secundarios,regime,regime_resolvido FROM empresas WHERE id=?').get(empresaId) || null;
  const historico = empresa ? perfilTributarioHistorico.consolidar(db, empresaId).historico : [];
  const perfil = historico.at(-1) || null;
  const conformidade = empresa ? conformidadeDocumental.listar(empresaId) : null;
  const planejamento = empresa ? db.prepare(`SELECT a.id,a.titulo,a.status,a.atualizado_em,
      (SELECT COUNT(*) FROM planejamento_resultados r WHERE r.analise_id=a.id) resultados
    FROM planejamento_analises a JOIN planejamento_analise_empresas ae ON ae.analise_id=a.id
    WHERE ae.empresa_id=? ORDER BY a.atualizado_em DESC,a.id DESC LIMIT 1`).get(empresaId) || null : null;
  return { empresa, perfil, conformidade, planejamento };
}

function montar(resultados, opcoes = {}) {
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
  const empresaId = Number(opcoes.empresaId || baseResultado.cenario?.empresa_id || 0) || null;
  const contexto = contextoEmpresa(empresaId);
  return {
    titulo:'Implementação da Reforma Tributária', subtitulo:'Diagnóstico executivo CBS', geradoEm:new Date().toISOString(),
    fonte:'motor_resultados via cenários, indicadores, alertas, matriz e memória de cálculo',
    empresa:contexto.empresa, perfilAtual:contexto.perfil, conformidadeDocumental:contexto.conformidade, planejamentoTributario:contexto.planejamento,
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
  const doc = new PDFDocument({ size:'A4', margin:0, bufferPages:true, info:{ Title:'Relatório de entrega - Sattva' } });
  doc.pipe(destino);
  const W=595.28, H=841.89, M=52, CW=W-(M*2), navy='#0C4264', tinta='#243746', cinza='#6A8191', fundo='#EEF4F7', turquesa='#24A5A4', ouro='#BF7B12', linha='#D4E0E7';
  const txt=(v)=>textoSeguro(v || 'INDETERMINADO');
  const cabeçalho=(subtitulo='Relatório de entrega')=>{ doc.rect(0,0,W,52).fill(navy); doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text('Sattva',M,17); doc.font('Helvetica').fontSize(9).fillColor('#DDEBF2').text('Implementação da Reforma Tributária',145,20); doc.text(subtitulo,414,20,{width:130,align:'right'}); };
  const titulo=(t, y)=>{ doc.fillColor(navy).font('Helvetica-Bold').fontSize(20).text(txt(t),M,y); return y+29; };
  const texto=(t,x,y,w,size=9,color=tinta)=>{ doc.fillColor(color).font('Helvetica').fontSize(size).text(txt(t),x,y,{width:w,lineGap:2}); return y+doc.heightOfString(txt(t),{width:w,lineGap:2}); };
  const caixa=(x,y,w,h,cor='#FFFFFF',borda=linha)=>{ doc.roundedRect(x,y,w,h,8).fillAndStroke(cor,borda); };
  const card=(x,y,w,rotulo,valor,apoio,cor=turquesa)=>{ const v=txt(valor); const tamanho=v.length > 11 ? 12 : 17; caixa(x,y,w,108); doc.roundedRect(x,y+100,w,8).fill(cor); doc.fillColor(cinza).font('Helvetica-Bold').fontSize(8).text(txt(rotulo).toUpperCase(),x+15,y+20,{width:w-30}); doc.fillColor(navy).font('Helvetica-Bold').fontSize(tamanho).text(v,x+15,y+49,{width:w-30,ellipsis:true}); doc.fillColor(cinza).font('Helvetica').fontSize(8).text(txt(apoio),x+15,y+80,{width:w-30}); };
  const linhaDado=(x,y,rotulo,valor,cor=navy)=>{ doc.fillColor(cinza).font('Helvetica').fontSize(9).text(txt(rotulo),x,y,{width:170}); doc.fillColor(cor).font('Helvetica-Bold').fontSize(10).text(txt(valor),x+175,y,{width:120,align:'right'}); return y+24; };
  const linhaPequena=(x,y,w,rotulo,valor,cor=navy)=>{ doc.fillColor(cinza).font('Helvetica').fontSize(8.5).text(txt(rotulo),x,y,{width:w*.48}); doc.fillColor(cor).font('Helvetica-Bold').fontSize(9).text(txt(valor),x+(w*.5),y,{width:w*.5,align:'right',ellipsis:true}); return y+24; };
  const natureza=(n)=>String(n || 'INDETERMINADO').replaceAll('_',' ');
  const empresa=relatorio.empresa || {}; const perfil=relatorio.perfilAtual || {}; const conf=relatorio.conformidadeDocumental || { resumo:{ total:0,valor:0 }, itens:[] }; const plan=relatorio.planejamentoTributario;
  const perfilPis=perfil.carga_pis_cofins_atual || {}; const perfilPisPct=perfil.carga_pis_cofins_percentual || {};

  cabeçalho('Relatório executivo'); let y=78;
  doc.fillColor(navy).font('Helvetica-Bold').fontSize(27).text('Diagnóstico e plano de adequação',M,y); y+=42;
  doc.fillColor(navy).font('Helvetica-Bold').fontSize(14).text(txt(empresa.razao_social || 'Empresa em análise'),M,y); y+=23;
  doc.fillColor(cinza).font('Helvetica').fontSize(10).text(`Cenário de referência: ${txt(relatorio.base.nome)}  |  Gerado em: ${new Date(relatorio.geradoEm).toLocaleString('pt-BR')}`,M,y); y+=36;
  caixa(M,y,CW,48,fundo); texto('Este relatório conta a história da operação atual, dos efeitos da CBS e das decisões que precisam ser avaliadas. Todos os valores vêm de fotografias oficiais já calculadas; dados ausentes permanecem explícitos.',M+16,y+14,CW-32,9,navy); y+=72;
  y=titulo('Informação da empresa',y);
  caixa(M,y,CW,93); let iy=y+18; iy=linhaDado(M+18,iy,'CNPJ',empresa.cnpj || 'INDETERMINADO'); iy=linhaDado(M+18,iy,'CNAE principal',empresa.cnae || 'INDETERMINADO'); linhaDado(M+18,iy,'Atividade',empresa.atividade || empresa.nome_fantasia || 'INDETERMINADO'); y+=118;
  y=titulo('Perfil tributário atual',y);
  const gap=12, cw=(CW-(gap*2))/3; card(M,y,cw,'Regime atual',String(empresa.regime_resolvido || empresa.regime || perfil.regime || 'INDETERMINADO').replaceAll('_',' '),'cadastro e histórico',navy); card(M+cw+gap,y,cw,'PIS/Cofins atual',perfilPis.valor===null||perfilPis.valor===undefined?'INDETERMINADO':brl(perfilPis.valor),`${natureza(perfilPis.natureza)} · ${perfilPis.origem || 'sem origem'}`,turquesa); card(M+(cw+gap)*2,y,cw,'Carga efetiva PIS/Cofins',perfilPisPct.valor===null||perfilPisPct.valor===undefined?'INDETERMINADO':pct(perfilPisPct.valor),natureza(perfilPisPct.natureza), '#5B8DB9');
  y+=132; y=titulo('Leitura executiva',y); caixa(M,y,CW,59,'#FFF7E4','#F4E1B9'); texto('O perfil atual é a referência para comparar o efeito da CBS. O relatório não substitui a apuração fiscal nem presume que uma divergência documental, sozinha, mude a carga tributária.',M+16,y+15,CW-32,9,ouro);

  doc.addPage(); cabeçalho('Cadeia e impacto CBS'); y=78;
  const metade=(CW-12)/2; y=titulo('Cadeia de fornecedores',y); caixa(M,y,metade,142); let fy=y+20; fy=linhaPequena(M+16,fy,metade-32,'Compras atuais',brl(relatorio.secoes.compras.valor)); fy=linhaPequena(M+16,fy,metade-32,'Base econômica',brl(relatorio.secoes.compras.baseEconomica)); linhaPequena(M+16,fy,metade-32,'Crédito CBS recebido',brl(relatorio.secoes.compras.credito),turquesa);
  const x2=M+metade+12; caixa(x2,y,metade,142); let cy=y+20; cy=linhaPequena(x2+16,cy,metade-32,'Crédito normal',brl(relatorio.base.creditoRecebido)); cy=linhaPequena(x2+16,cy,metade-32,'Custo efetivo',brl(relatorio.base.custoEfetivo)); linhaPequena(x2+16,cy,metade-32,'Operações',String(relatorio.base.operacoesCompras)); y+=167;
  y=titulo('Cadeia de clientes',y); caixa(M,y,metade,142); let vy=y+20; vy=linhaPequena(M+16,vy,metade-32,'Vendas atuais',brl(relatorio.secoes.vendas.valor)); vy=linhaPequena(M+16,vy,metade-32,'Base econômica',brl(relatorio.secoes.vendas.baseEconomica)); linhaPequena(M+16,vy,metade-32,'CBS das vendas',brl(relatorio.secoes.vendas.cbs),'#5B8DB9');
  caixa(x2,y,metade,142); let ly=y+20; ly=linhaPequena(x2+16,ly,metade-32,'Venda projetada',brl(relatorio.secoes.vendas.precoProjetado)); ly=linhaPequena(x2+16,ly,metade-32,'Crédito entregue',brl(relatorio.base.creditoEntregue)); linhaPequena(x2+16,ly,metade-32,'Operações',String(relatorio.base.operacoesVendas)); y+=168;
  y=titulo('Impacto da CBS',y); card(M,y,cw,'CBS débito',brl(relatorio.base.cbsDebito),'efeito nas vendas','#5B8DB9'); card(M+cw+gap,y,cw,'CBS crédito',brl(relatorio.base.cbsCredito),'efeito nas compras',turquesa); card(M+(cw+gap)*2,y,cw,'CBS líquida',brl(relatorio.base.cbsLiquida),'débito menos crédito',navy);

  doc.addPage(); cabeçalho('Conformidade, cenários e planejamento'); y=78;
  y=titulo('Conformidade documental',y); caixa(M,y,CW,83,'#FFF7E4','#F4E1B9'); doc.fillColor(ouro).font('Helvetica-Bold').fontSize(9).text('PONTOS A VALIDAR',M+16,y+17); doc.fillColor(navy).font('Helvetica-Bold').fontSize(20).text(String(conf.resumo?.total || 0),M+16,y+38); doc.fillColor(tinta).font('Helvetica').fontSize(9).text(`apontamento(s) documentais · valor envolvido ${brl(conf.resumo?.valor)}`,M+55,y+45); texto('Apontamentos documentais são evidência para revisão. Só devem se tornar prioridade econômica quando o motor demonstrar impacto material na carga, crédito ou preço.',M+16,y+63,CW-32,8,cinza); y+=104;
  const exemplos=(conf.itens || []).slice(0,3); if(exemplos.length){ exemplos.forEach((x)=>{ caixa(M,y,CW,42,'#FFFFFF',linha); doc.fillColor(navy).font('Helvetica-Bold').fontSize(9).text(txt(x.titulo),M+14,y+9,{width:220}); texto(x.evidencia,M+14,y+22,CW-28,8,cinza); y+=50; }); } else { caixa(M,y,CW,42,fundo); texto('Nenhum apontamento documental disponível para a fotografia selecionada.',M+14,y+14,CW-28,9,cinza); y+=56; }
  y=titulo('Cenários',y); caixa(M,y,CW,Math.max(68, 25+(relatorio.comparacao.length*19))); let sy=y+15; relatorio.comparacao.slice(0,5).forEach((x)=>{ doc.fillColor(navy).font('Helvetica-Bold').fontSize(9).text(txt(x.cenario),M+16,sy,{width:200}); doc.font('Helvetica').fillColor(tinta).text(`CBS líquida ${brl(x.cbsLiquida)} | variação ${brl(x.deltaCbsLiquida)} | ${natureza(x.natureza)}`,M+222,sy,{width:CW-238}); sy+=19; }); y+=Math.max(84, 41+(relatorio.comparacao.length*19));
  y=titulo('Planejamento tributário',y); caixa(M,y,CW,72, plan ? '#EAF6F6' : fundo, linha); doc.fillColor(plan?turquesa:cinza).font('Helvetica-Bold').fontSize(9).text(plan?'ESTUDO MAIS RECENTE':'STATUS',M+16,y+16); doc.fillColor(navy).font('Helvetica-Bold').fontSize(12).text(plan?txt(plan.titulo):'Ainda não há estudo de planejamento vinculado',M+16,y+32,{width:CW-32}); texto(plan?`Status: ${txt(plan.status)} · ${plan.resultados || 0} resultado(s) registrado(s) · atualização ${txt(plan.atualizado_em)}`:'Crie o estudo no Módulo 5 para comparar regimes, receita projetada, folha, margem e as decisões de preço.',M+16,y+50,CW-32,8,cinza);

  const paginas=doc.bufferedPageRange(); for(let i=0;i<paginas.count;i++){ doc.switchToPage(i); doc.strokeColor(linha).moveTo(M,H-38).lineTo(W-M,H-38).stroke(); doc.fillColor(cinza).font('Helvetica').fontSize(8).text('Sattva · Relatório de entrega · Valores auditáveis na memória de cálculo',M,H-28); doc.text(`Página ${i+1} de ${paginas.count}`,W-130,H-28,{width:78,align:'right'}); }
  doc.end(); return doc;
}

// A planilha de apoio é uma representação tabular do mesmo relatório. Ela
// preserva naturezas e limitações, sem calcular ou persistir nada novo.
function gerarXlsx(relatorio) {
  const livro = XLSX.utils.book_new();
  const adicionar = (nome, linhas) => XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(linhas), nome.slice(0, 31));
  const b = relatorio.base;
  adicionar('Resumo executivo', [
    ['CAMPO', 'VALOR', 'NATUREZA'], ['Cenário base', b.nome, b.natureza], ['Ano', b.ano, b.natureza],
    ['Receita atual', b.receita, b.natureza], ['Compras atuais', b.compras, b.natureza],
    ['Base econômica das saídas', b.baseEconomicaSaidas, b.natureza], ['Base econômica das entradas', b.baseEconomicaEntradas, b.natureza],
    ['CBS débito', b.cbsDebito, b.natureza], ['CBS crédito', b.cbsCredito, b.natureza], ['CBS líquida', b.cbsLiquida, b.natureza],
    ['Crédito recebido', b.creditoRecebido, b.natureza], ['Crédito entregue', b.creditoEntregue, b.natureza], ['Custo efetivo', b.custoEfetivo, b.natureza],
    ['Operações de compras', b.operacoesCompras, b.natureza], ['Operações de vendas', b.operacoesVendas, b.natureza],
  ]);
  adicionar('Cenários', [
    ['CENÁRIO', 'NATUREZA', 'RECEITA PROJETADA', 'CBS LÍQUIDA', 'Δ CBS', 'CRÉDITO RECEBIDO', 'CUSTO EFETIVO', 'MARGEM', 'CAIXA'],
    ...relatorio.comparacao.map((x) => [x.cenario, x.natureza, x.receitaProjetada, x.cbsLiquida, x.deltaCbsLiquida, x.creditoRecebido, x.custoEfetivo, x.margem, x.caixa]),
  ]);
  const evidencias = [
    ...relatorio.secoes.oportunidades.map((x) => ({ grupo:'OPORTUNIDADE', ...x })),
    ...relatorio.secoes.atencoes.map((x) => ({ grupo:'PONTO DE ATENÇÃO', ...x })),
    ...relatorio.secoes.limitacoes.map((x) => ({ grupo:'LIMITAÇÃO / DADO INDETERMINADO', ...x })),
  ];
  adicionar('Conformidade e evidências', [
    ['CLASSIFICAÇÃO', 'TÍTULO / CENÁRIO', 'EVIDÊNCIA', 'NATUREZA'],
    ...evidencias.map((x) => [x.grupo, x.titulo || x.cenario || '', x.texto || x.evidencia || '', x.natureza || 'INDETERMINADO']),
  ]);
  adicionar('Premissas', [
    ['CENÁRIO', 'TIPO', 'CAMPO / REGRA', 'VALOR SIMULADO', 'JUSTIFICATIVA', 'FONTE', 'NATUREZA'],
    ...relatorio.secoes.premissas.map((x) => [x.cenario, x.tipo, x.campo || `${x.grupo_origem || ''} → ${x.grupo_destino || ''}`, x.valor_simulado || x.percentual_grupo || '', x.justificativa || '', x.fonte || '', x.natureza || 'SIMULADO']),
  ]);
  adicionar('Metodologia', [
    ['CAMPO', 'DESCRIÇÃO'], ['Fonte', relatorio.fonte], ['Metodologia', relatorio.secoes.metodologia.texto],
    ['Aviso', 'A planilha organiza resultados oficiais já calculados. Divergências documentais não são tratadas como alteração de carga sem impacto econômico calculado.'],
  ]);
  return XLSX.write(livro, { type:'buffer', bookType:'xlsx' });
}

module.exports = { montar, gerarPdf, gerarXlsx, fotografia, premissasDoCenario };

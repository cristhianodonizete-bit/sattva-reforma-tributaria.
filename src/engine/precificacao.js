/**
 * MÓDULO 2/3 — PRECIFICAÇÃO E MARGEM
 * ---------------------------------------------------------------------------
 * Fórmula da cartilha:   Receita (-) Impostos (-) Custos = Margem Bruta
 *
 * O objetivo é responder três perguntas:
 *  1. Se eu NÃO mexer no preço, o que acontece com a minha margem?
 *  2. Qual o preço que PRESERVA a margem atual (preço neutro)?
 *  3. O meu cliente aguenta esse preço? (depende de ele se creditar ou não)
 */

const P = require('../config/parametros');
const { grossDown, aplicarIVA, r2, r4 } = require('./calculadora');

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/**
 * @param {object} item
 *   descricao, ncm
 *   precoVenda ........ preço praticado hoje (com tributos)
 *   custoCompra ....... custo de aquisição hoje (com tributos)
 *   regime ............ regime da EMPRESA (vendedora)
 *   regimeFornecedor .. regime predominante do fornecedor do insumo
 *   tipo .............. 'mercadoria' | 'servico'
 *   reducao ........... enquadramento do IVA na venda
 *   despesasVariaveis . % sobre a receita (comissões, frete, taxas)
 *   ano ............... ano do cenário
 *   perfilCliente ..... regime do cliente (define se ele credita)
 */
function analisarItem(item) {
  const ano = Number(item.ano) || 2033;
  const tipo = item.tipo === 'servico' ? 'servico' : 'mercadoria';
  const regime = item.regime || 'lucro_real';
  const regimeFornecedor = item.regimeFornecedor || regime;
  const perfilCliente = item.perfilCliente || 'lucro_real';
  const despVar = num(item.despesasVariaveis);

  // ---------- HOJE ----------
  const venda = grossDown({ valor: num(item.precoVenda), regime, tipo,
    aliqIcms: item.aliqIcms, aliqIss: item.aliqIss, aliqIpi: item.aliqIpi, aliqSimples: item.aliqSimples });
  const compra = grossDown({ valor: num(item.custoCompra), regime: regimeFornecedor, tipo,
    aliqIcms: item.aliqIcmsCompra, aliqIss: item.aliqIssCompra, aliqSimples: item.aliqSimplesCompra });

  // crédito que a empresa toma hoje na compra
  const { creditoAtual } = require('./calculadora');
  const credHoje = creditoAtual(compra, regime);
  const custoLiquidoHoje = r2(compra.valorOperacao - credHoje.total);

  const receitaLiquidaHoje = r2(venda.valorOperacao - venda.totalTributos);
  const despesaHoje = r2(venda.valorOperacao * despVar);
  const margemHoje = r2(receitaLiquidaHoje - custoLiquidoHoje - despesaHoje);
  const margemPercHoje = venda.valorOperacao ? r4(margemHoje / venda.valorOperacao) : 0;
  const markupHoje = custoLiquidoHoje ? r4(margemHoje / custoLiquidoHoje) : 0;

  // ---------- CENÁRIO: PREÇO CONGELADO ----------
  const novoVenda = aplicarIVA({ valorSemImposto: venda.valorSemImposto, ano, reducao: item.reducao,
    aliqEspecifica: item.aliqEspecifica, regime, grauRepasse: 0, atual: venda });
  const novoCompra = aplicarIVA({ valorSemImposto: compra.valorSemImposto, ano, reducao: item.reducaoCompra,
    regime: regimeFornecedor, grauRepasse: 1, atual: compra });
  const { creditoNovo } = require('./calculadora');
  const credNovo = creditoNovo(novoCompra, regimeFornecedor, regime, compra);
  const custoLiquidoNovo = r2(novoCompra.precoFinal - credNovo.total);

  const receitaLiqCongelado = r2(venda.valorOperacao - novoVenda.totalTributos);
  const despesaCongelado = r2(venda.valorOperacao * despVar);
  const margemCongelado = r2(receitaLiqCongelado - custoLiquidoNovo - despesaCongelado);
  const margemPercCongelado = venda.valorOperacao ? r4(margemCongelado / venda.valorOperacao) : 0;

  // ---------- CENÁRIO: PREÇO NEUTRO (preserva margem em R$) ----------
  // Preço tal que:  P - trib(P) - despVar*P - custoLiquidoNovo = margemHoje
  // Com IVA por fora sobre a base limpa B:  P = B*(1+a) + residual
  // => B = (margemHoje + custoLiquidoNovo) / (1 - despVar*(1+a)) ... resolvido numericamente
  const aliq = novoVenda.aliquotas.total;
  const residualUnit = novoVenda.residual.total;
  const precoNeutro = resolverPrecoNeutro({ alvoMargem: margemHoje, custo: custoLiquidoNovo, aliq,
    residual: residualUnit, despVar, compensavel: novoVenda.compensavel });

  const novoNeutro = aplicarIVA({ valorSemImposto: r2(precoNeutro / (1 + (novoVenda.compensavel ? 0 : aliq))), ano,
    reducao: item.reducao, aliqEspecifica: item.aliqEspecifica, regime, grauRepasse: 1, atual: venda });

  // ---------- SENSIBILIDADE DO CLIENTE ----------
  const cliente = P.REGIMES[perfilCliente] || P.REGIMES.lucro_real;
  const clienteCredita = cliente.creditaNovo;
  const custoParaClienteHoje = r2(venda.valorOperacao - (clienteCredita ? creditoAtual(venda, perfilCliente).total : 0));
  const novoParaCliente = aplicarIVA({ valorSemImposto: venda.valorSemImposto, ano, reducao: item.reducao,
    aliqEspecifica: item.aliqEspecifica, regime, grauRepasse: 1, atual: venda });
  const credCliente = clienteCredita ? creditoNovo(novoParaCliente, regime, perfilCliente, venda).total : 0;
  const custoParaClienteNovo = r2(precoNeutro - credCliente);

  return {
    item: { descricao: item.descricao || '', ncm: item.ncm || '', tipo, regime, ano },
    hoje: {
      preco: venda.valorOperacao, tributos: venda.totalTributos, cargaEfetiva: venda.cargaEfetiva,
      receitaLiquida: receitaLiquidaHoje, custoLiquido: custoLiquidoHoje, despesasVariaveis: despesaHoje,
      margem: margemHoje, margemPerc: margemPercHoje, markup: markupHoje,
      precoSemImposto: venda.valorSemImposto, custoSemImposto: compra.valorSemImposto,
    },
    precoCongelado: {
      preco: venda.valorOperacao, tributos: novoVenda.totalTributos, cargaEfetiva: novoVenda.cargaEfetiva,
      receitaLiquida: receitaLiqCongelado, custoLiquido: custoLiquidoNovo,
      margem: margemCongelado, margemPerc: margemPercCongelado,
      variacaoMargem: r2(margemCongelado - margemHoje),
      variacaoMargemPerc: margemHoje ? r4((margemCongelado - margemHoje) / Math.abs(margemHoje)) : 0,
    },
    precoNeutro: {
      preco: r2(precoNeutro),
      reajusteNecessario: venda.valorOperacao ? r4((precoNeutro - venda.valorOperacao) / venda.valorOperacao) : 0,
      variacaoAbsoluta: r2(precoNeutro - venda.valorOperacao),
      tributos: novoNeutro.totalTributos, cargaEfetiva: novoNeutro.cargaEfetiva,
      margem: margemHoje, margemPerc: precoNeutro ? r4(margemHoje / precoNeutro) : 0,
    },
    cliente: {
      perfil: perfilCliente, label: cliente.label, credita: clienteCredita,
      custoHoje: custoParaClienteHoje, custoNovo: custoParaClienteNovo,
      variacao: r2(custoParaClienteNovo - custoParaClienteHoje),
      variacaoPerc: custoParaClienteHoje ? r4((custoParaClienteNovo - custoParaClienteHoje) / custoParaClienteHoje) : 0,
      leitura: clienteCredita
        ? 'Cliente do regime regular: aproveita 100% do IBS/CBS destacado. O reajuste do preço com IVA tende a ser neutro para ele — a negociação deve ser feita sobre o preço SEM imposto.'
        : 'Cliente que NÃO credita (PF, Simples no DAS, órgão público ou imune): sente o preço cheio. Aqui está o risco comercial real da reforma — avaliar reposicionamento, mix e comunicação.',
    },
    recomendacoes: recomendar({ margemPercHoje, margemPercCongelado, precoNeutro, precoAtual: venda.valorOperacao, clienteCredita, tipo, regime, ano }),
  };
}

function resolverPrecoNeutro({ alvoMargem, custo, aliq, residual, despVar, compensavel }) {
  const a = compensavel ? 0 : aliq;
  // P = B*(1+a) + residual ; margem = P - (B*a + residual) - despVar*P - custo
  //  => margem = B + residual - residual ... resolvendo direto:
  // P - tributos = B + residual - residual = B   (o residual entra no preço e sai como tributo)
  // margem = B - despVar*P - custo  e  P = B*(1+a) + residual
  // => B = alvoMargem + custo + despVar*P
  // Iteração de ponto fixo (converge em poucas passadas):
  let P0 = (alvoMargem + custo) * (1 + a) + residual;
  for (let i = 0; i < 60; i++) {
    const B = alvoMargem + custo + despVar * P0;
    const P1 = B * (1 + a) + residual;
    if (Math.abs(P1 - P0) < 0.0001) { P0 = P1; break; }
    P0 = P1;
  }
  return Math.max(P0, 0);
}

function recomendar(ctx) {
  const rec = [];
  const queda = ctx.margemPercHoje - ctx.margemPercCongelado;
  const reajuste = ctx.precoAtual ? (ctx.precoNeutro - ctx.precoAtual) / ctx.precoAtual : 0;

  if (queda > 0.02) {
    rec.push({ nivel: 'alto', texto: `Manter o preço atual em ${ctx.ano} corrói ${(queda * 100).toFixed(2).replace('.', ',')} p.p. de margem bruta. É necessário reposicionamento.` });
  } else if (queda < -0.02) {
    rec.push({ nivel: 'bom', texto: `A operação GANHA margem no novo modelo (${(Math.abs(queda) * 100).toFixed(2).replace('.', ',')} p.p.). Há espaço para política comercial agressiva ou repasse parcial de ganho ao cliente.` });
  }
  if (reajuste > 0.03) {
    rec.push({ nivel: 'atencao', texto: `Preço neutro exige reajuste de ${(reajuste * 100).toFixed(2).replace('.', ',')}%. Planejar em degraus ao longo da transição, não de uma vez.` });
  }
  if (ctx.tipo === 'servico' && ['lucro_presumido', 'simples_nacional'].includes(ctx.regime)) {
    rec.push({ nivel: 'alto', texto: 'Serviço prestado por empresa de Lucro Presumido/Simples: é o perfil mais impactado da reforma (baixo volume de créditos na entrada e alta alíquota na saída). Priorizar este item no plano de adequação.' });
  }
  if (!ctx.clienteCredita && reajuste > 0.01) {
    rec.push({ nivel: 'alto', texto: 'A carteira deste item é de clientes que não creditam. O repasse integral é comercialmente arriscado — simular cenários de repasse parcial (50%/70%) e avaliar impacto no volume.' });
  }
  if (!rec.length) rec.push({ nivel: 'info', texto: 'Impacto pouco relevante neste item. Monitorar na etapa de acompanhamento do planejamento.' });
  return rec;
}

module.exports = { analisarItem, resolverPrecoNeutro };

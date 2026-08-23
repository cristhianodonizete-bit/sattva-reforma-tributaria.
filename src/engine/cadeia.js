/**
 * MÓDULO 1 — DIAGNÓSTICO
 *  1.b Análise da Cadeia de Fornecedores
 *  1.c Análise da Cadeia de Clientes
 *  1.d Projeção de Cenários
 *
 * Agrega a movimentação importada e roda o motor de cálculo sobre cada
 * registro, consolidando por parceiro, por regime e por ano.
 */

const P = require('../config/parametros');
const { calcularOperacao, r2, r4 } = require('./calculadora');

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const soma = (arr, f) => arr.reduce((s, x) => s + num(f(x)), 0);

/**
 * @param {Array} movimentos  linhas da movimentação (fornecedores ou clientes)
 * @param {object} cfg  { regimeEmpresa, anos, grauRepasse, lado: 'fornecedor'|'cliente' }
 */
function analisarCadeia(movimentos, cfg = {}) {
  const regimeEmpresa = cfg.regimeEmpresa || 'lucro_real';
  const anos = (cfg.anos && cfg.anos.length ? cfg.anos : P.ANOS).map(Number);
  const lado = cfg.lado === 'cliente' ? 'cliente' : 'fornecedor';

  const porParceiro = new Map();
  const porRegime = new Map();
  const porAno = new Map(anos.map((a) => [a, { ano: a, valor: 0, tributos: 0, credito: 0, custoEfetivo: 0, precoFinal: 0 }]));
  let totalValor = 0, totalTributosHoje = 0, totalCreditoHoje = 0, totalCustoHoje = 0;

  const detalhes = [];

  for (const m of movimentos) {
    const regimeParceiro = m.regime || m.regime_tributario || 'lucro_real';
    // No lado do cliente, quem emite é a EMPRESA; no lado do fornecedor, quem
    // emite é o parceiro. O crédito é sempre analisado do ponto de vista de
    // quem recebe a nota.
    const regimeEmitente = lado === 'fornecedor' ? regimeParceiro : regimeEmpresa;
    const regimeAdquirente = lado === 'fornecedor' ? regimeEmpresa : regimeParceiro;

    const res = calcularOperacao({
      valor: num(m.valor), baseCalculo: num(m.base_calculo) || num(m.baseCalculo),
      regime: regimeEmitente, regimeAdquirente,
      tipo: m.tipo || (m.ncm ? 'mercadoria' : 'servico'),
      icms: m.icms, pis: m.pis, cofins: m.cofins, ipi: m.ipi, iss: m.iss,
      icmsSt: m.icms_st || m.icmsSt, pisCofins: m.pis_cofins || m.pisCofins,
      reducao: m.reducao || 'integral', aliqEspecifica: m.aliq_especifica,
      grauRepasse: cfg.grauRepasse, anos, parametrosIVA: cfg.parametrosIVA,
    });

    const chave = m.cnpj || m.inscr_federal || m.nome || 'SEM IDENTIFICAÇÃO';
    if (!porParceiro.has(chave)) {
      porParceiro.set(chave, {
        chave, nome: m.nome || m.descricao || chave, cnpj: m.cnpj || m.inscr_federal || '',
        regime: regimeParceiro, regimeLabel: (P.REGIMES[regimeParceiro] || {}).label || regimeParceiro,
        itens: 0, valor: 0, tributos: 0, creditoHoje: 0, custoHoje: 0,
        custoFinal: 0, precoFinal: 0, creditoFinal: 0,
      });
    }
    const p = porParceiro.get(chave);
    const ultimo = res.projecao[res.projecao.length - 1];
    p.itens += 1;
    p.valor += res.atual.valorOperacao;
    p.tributos += res.atual.totalTributos;
    p.creditoHoje += res.atual.credito.total;
    p.custoHoje += res.atual.custoEfetivo;
    p.custoFinal += ultimo.custoEfetivo;
    p.precoFinal += ultimo.precoFinal;
    p.creditoFinal += ultimo.credito.total;

    if (!porRegime.has(regimeParceiro)) {
      porRegime.set(regimeParceiro, { regime: regimeParceiro, label: (P.REGIMES[regimeParceiro] || {}).label || regimeParceiro,
        parceiros: new Set(), valor: 0, tributos: 0, creditoHoje: 0, creditoFinal: 0, custoHoje: 0, custoFinal: 0 });
    }
    const rg = porRegime.get(regimeParceiro);
    rg.parceiros.add(chave);
    rg.valor += res.atual.valorOperacao;
    rg.tributos += res.atual.totalTributos;
    rg.creditoHoje += res.atual.credito.total;
    rg.creditoFinal += ultimo.credito.total;
    rg.custoHoje += res.atual.custoEfetivo;
    rg.custoFinal += ultimo.custoEfetivo;

    for (const proj of res.projecao) {
      const a = porAno.get(proj.ano);
      if (!a) continue;
      a.valor += res.atual.valorOperacao;
      a.tributos += proj.totalTributos;
      a.credito += proj.credito.total;
      a.custoEfetivo += proj.custoEfetivo;
      a.precoFinal += proj.precoFinal;
    }

    totalValor += res.atual.valorOperacao;
    totalTributosHoje += res.atual.totalTributos;
    totalCreditoHoje += res.atual.credito.total;
    totalCustoHoje += res.atual.custoEfetivo;

    detalhes.push({
      parceiro: p.nome, cnpj: p.cnpj, regime: regimeParceiro, produto: m.descricao || m.produto || '',
      ncm: m.ncm || '', valor: res.atual.valorOperacao, valorSemImposto: res.atual.valorSemImposto,
      tributosHoje: res.atual.totalTributos, creditoHoje: res.atual.credito.total,
      custoHoje: res.atual.custoEfetivo, custoFinal: ultimo.custoEfetivo,
      variacao: ultimo.variacaoCusto, variacaoPerc: ultimo.variacaoCustoPerc,
    });
  }

  const parceiros = [...porParceiro.values()].map((p) => ({
    ...p,
    representatividade: totalValor ? r4(p.valor / totalValor) : 0,
    variacaoCusto: r2(p.custoFinal - p.custoHoje),
    variacaoCustoPerc: p.custoHoje ? r4((p.custoFinal - p.custoHoje) / p.custoHoje) : 0,
    valor: r2(p.valor), tributos: r2(p.tributos), creditoHoje: r2(p.creditoHoje),
    custoHoje: r2(p.custoHoje), custoFinal: r2(p.custoFinal), creditoFinal: r2(p.creditoFinal),
    precoFinal: r2(p.precoFinal),
  })).sort((a, b) => b.valor - a.valor);

  // Curva ABC por representatividade
  let acumulado = 0;
  for (const p of parceiros) {
    acumulado += p.representatividade;
    p.acumulado = r4(acumulado);
    p.classeAbc = acumulado <= 0.8 ? 'A' : acumulado <= 0.95 ? 'B' : 'C';
  }

  const regimes = [...porRegime.values()].map((r) => ({
    regime: r.regime, label: r.label, parceiros: r.parceiros.size,
    valor: r2(r.valor), representatividade: totalValor ? r4(r.valor / totalValor) : 0,
    tributos: r2(r.tributos), creditoHoje: r2(r.creditoHoje), creditoFinal: r2(r.creditoFinal),
    variacaoCredito: r2(r.creditoFinal - r.creditoHoje),
    custoHoje: r2(r.custoHoje), custoFinal: r2(r.custoFinal),
    variacaoCusto: r2(r.custoFinal - r.custoHoje),
  })).sort((a, b) => b.valor - a.valor);

  const cenarios = [...porAno.values()].map((a) => ({
    ano: a.ano, nota: P.CRONOGRAMA[a.ano] ? P.CRONOGRAMA[a.ano].nota : '',
    valor: r2(a.valor), tributos: r2(a.tributos), credito: r2(a.credito),
    custoEfetivo: r2(a.custoEfetivo), precoFinal: r2(a.precoFinal),
    cargaEfetiva: a.precoFinal ? r4(a.tributos / a.precoFinal) : 0,
    variacaoCusto: r2(a.custoEfetivo - totalCustoHoje),
    variacaoCustoPerc: totalCustoHoje ? r4((a.custoEfetivo - totalCustoHoje) / totalCustoHoje) : 0,
  }));

  return {
    lado, regimeEmpresa, anos,
    totais: {
      registros: movimentos.length, parceiros: parceiros.length,
      valor: r2(totalValor), tributosHoje: r2(totalTributosHoje),
      creditoHoje: r2(totalCreditoHoje), custoHoje: r2(totalCustoHoje),
      cargaEfetivaHoje: totalValor ? r4(totalTributosHoje / totalValor) : 0,
    },
    parceiros, regimes, cenarios, detalhes,
    riscos: mapearRiscos({ lado, parceiros, regimes, totalValor }),
  };
}

function mapearRiscos({ lado, parceiros, regimes, totalValor }) {
  const riscos = [];
  const semCredito = regimes.filter((r) => ['simples_nacional', 'mei', 'produtor_rural_pf', 'imune_isento'].includes(r.regime));
  const partSemCredito = semCredito.reduce((s, r) => s + r.representatividade, 0);

  if (lado === 'fornecedor') {
    if (partSemCredito > 0.15) {
      riscos.push({ nivel: 'alto', titulo: 'Concentração de compras em fornecedores que não geram crédito integral',
        texto: `${(partSemCredito * 100).toFixed(1).replace('.', ',')}% do volume de compras vem de Simples/MEI/produtor rural/imunes. No novo modelo o crédito é limitado ao embutido no DAS, encarecendo o custo efetivo.`,
        acao: 'Negociar preço com esses fornecedores, incentivar a opção pelo regime regular de IBS/CBS ou revisar a base de fornecimento dos itens de maior valor.' });
    }
    const concentrados = parceiros.filter((p) => p.classeAbc === 'A' && ['simples_nacional', 'mei'].includes(p.regime));
    if (concentrados.length) {
      riscos.push({ nivel: 'alto', titulo: 'Fornecedores classe A no Simples/MEI',
        texto: `${concentrados.length} fornecedor(es) da classe A (80% do volume) estão no Simples ou MEI: ${concentrados.slice(0, 5).map((p) => p.nome).join(', ')}.`,
        acao: 'Tratativa individual: renegociação de preço com base no valor SEM imposto e cláusula contratual de repasse de crédito.' });
    }
    const piora = parceiros.filter((p) => p.variacaoCustoPerc > 0.05).slice(0, 10);
    if (piora.length) {
      riscos.push({ nivel: 'atencao', titulo: 'Fornecedores com aumento de custo efetivo acima de 5%',
        texto: `${piora.length} fornecedor(es) elevam o custo efetivo de aquisição em mais de 5% no cenário final.`,
        acao: 'Incluir na pauta de renegociação e no plano de adequação de compras.' });
    }
  } else {
    const naoCredita = regimes.filter((r) => !((P.REGIMES[r.regime] || {}).creditaNovo));
    const partNaoCredita = naoCredita.reduce((s, r) => s + r.representatividade, 0);
    if (partNaoCredita > 0.2) {
      riscos.push({ nivel: 'alto', titulo: 'Carteira concentrada em clientes que não se creditam',
        texto: `${(partNaoCredita * 100).toFixed(1).replace('.', ',')}% do faturamento vem de PF, Simples no DAS, órgãos públicos ou entidades imunes — perfis que sentem o preço cheio.`,
        acao: 'Definir política de repasse gradual, revisar mix de produtos/serviços e preparar argumentação comercial antes de 2027.' });
    }
    const credita = regimes.filter((r) => ((P.REGIMES[r.regime] || {}).creditaNovo));
    const partCredita = credita.reduce((s, r) => s + r.representatividade, 0);
    if (partCredita > 0.5) {
      riscos.push({ nivel: 'bom', titulo: 'Carteira majoritariamente B2B do regime regular',
        texto: `${(partCredita * 100).toFixed(1).replace('.', ',')}% do faturamento é para clientes que aproveitam 100% do IBS/CBS.`,
        acao: 'Negociação comercial deve migrar para o preço SEM imposto. Oportunidade de ganho competitivo frente a concorrentes do Simples.' });
    }
    if (regimes.some((r) => r.regime === 'orgao_publico')) {
      riscos.push({ nivel: 'atencao', titulo: 'Contratos com órgãos públicos',
        texto: 'Há faturamento para órgãos públicos na carteira.',
        acao: 'Acionar cláusula de reequilíbrio econômico-financeiro nos contratos administrativos vigentes antes da virada de 2027.' });
    }
  }
  if (!riscos.length) riscos.push({ nivel: 'info', titulo: 'Sem riscos críticos identificados nesta cadeia', texto: 'A composição analisada não apresenta concentração relevante de risco.', acao: 'Manter monitoramento no módulo de Acompanhamento do Planejamento.' });
  return riscos;
}

module.exports = { analisarCadeia };

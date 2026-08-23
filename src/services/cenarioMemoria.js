/**
 * MEMÓRIA DE CÁLCULO DO CENÁRIO
 * ---------------------------------------------------------------------------
 * Dois níveis, como pedido:
 *
 *   NÍVEL 1 — memória do GRUPO: como o agregado foi construído, quanto migrou,
 *             de onde para onde, e qual o impacto econômico.
 *   NÍVEL 2 — DRILL-DOWN: os itens que compõem aquele grupo, com documento,
 *             fornecedor, classificação, CST, cClassTrib, base e regra usada.
 *
 * O princípio: o agregado simplifica a simulação, o detalhe sustenta a prova.
 * Nenhum número do nível 1 existe sem os itens do nível 2 que o formaram.
 */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const pct = (n) => `${(num(n) * 100).toFixed(2).replace('.', ',')}%`;
const brl = (n) => num(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Memória do grupo: reconstrói a conta que levou do base ao cenário.
 * @param {object} resultado saída de cenarioMotor.executarCenario
 */
function memoriaGrupo(resultado, lado, dimensao, grupo) {
  const itensCen = (lado === 'compras' ? resultado.entradas : resultado.saidas)
    .filter((x) => x.grupos && x.grupos[dimensao] === grupo);
  const compBase = ((resultado.base && resultado.base.composicao[lado]) || {})[dimensao];
  const compCen = (resultado.composicao[lado] || {})[dimensao];
  const gBase = compBase ? compBase.grupos.find((g) => g.grupo === grupo) : null;
  const gCen = compCen ? compCen.grupos.find((g) => g.grupo === grupo) : null;

  // migrações que saíram deste grupo e que entraram nele
  const saiu = resultado.migracoes.filter((m) => m.dimensao === dimensao && m.de === grupo);
  const entrou = resultado.migracoes.filter((m) => m.dimensao === dimensao && m.para === grupo);

  const passos = [];
  if (gBase) {
    passos.push({ etapa: 'Composição do cenário base', natureza: 'CALCULADO',
      valor: r2(gBase.valor), participacao: r6(gBase.participacao),
      texto: `${gBase.nome}: ${brl(gBase.valor)} — ${pct(gBase.participacao)} do total, ${gBase.entidades} parceiros em ${gBase.itens} lançamentos.` });
  }
  for (const m of agrupaMigracoes(saiu)) {
    passos.push({ etapa: 'Migração de saída', natureza: 'SIMULADO',
      valor: r2(-m.valor),
      texto: `${pct(m.percentualGrupo)} do grupo migrou para "${m.para}", equivalente a ${brl(m.valor)}. Cada lançamento migrou essa mesma fração do próprio valor — o mix tributário do grupo foi preservado.` });
  }
  for (const m of agrupaMigracoes(entrou)) {
    passos.push({ etapa: 'Migração de entrada', natureza: 'SIMULADO',
      valor: r2(m.valor),
      texto: `Recebeu ${brl(m.valor)} vindos de "${m.de}" (${pct(m.percentualGrupo)} daquele grupo).` });
  }
  if (gCen) {
    passos.push({ etapa: 'Composição resultante', natureza: gCen.natureza,
      valor: r2(gCen.valor), participacao: r6(gCen.participacao),
      texto: `${brl(gCen.valor)} — ${pct(gCen.participacao)} do total.` });
  }

  const delta = (a, b) => r2(num(b) - num(a));
  return {
    lado, dimensao, grupo,
    nome: (gCen || gBase || {}).nome || grupo,
    base: gBase ? resumo(gBase) : null,
    cenario: gCen ? resumo(gCen) : null,
    variacao: gBase && gCen ? {
      valor: delta(gBase.valor, gCen.valor),
      participacao: r6(num(gCen.participacao) - num(gBase.participacao)),
      creditoTotal: delta(gBase.creditoIbs + gBase.creditoCbs, gCen.creditoIbs + gCen.creditoCbs),
      custoEfetivo: delta(gBase.custoEfetivo, gCen.custoEfetivo),
    } : null,
    passos,
    migracoes: { saida: agrupaMigracoes(saiu), entrada: agrupaMigracoes(entrou) },
    itens: itensCen.length,
    natureza: itensCen.some((x) => x.natureza === 'SIMULADO') ? 'SIMULADO' : 'CALCULADO',
  };
}

function resumo(g) {
  return {
    valor: r2(g.valor), participacao: r6(g.participacao), itens: g.itens, entidades: g.entidades,
    baseEconomica: r2(g.baseEconomica), ibs: r2(g.ibs), cbs: r2(g.cbs),
    creditoIbs: r2(g.creditoIbs), creditoCbs: r2(g.creditoCbs),
    creditoTotal: r2(num(g.creditoIbs) + num(g.creditoCbs)),
    custoEfetivo: r2(g.custoEfetivo),
    taxaRecuperacao: g.valor ? r6((num(g.creditoIbs) + num(g.creditoCbs)) / g.valor) : 0,
    natureza: g.natureza,
  };
}

function agrupaMigracoes(lista) {
  const mapa = new Map();
  for (const m of lista) {
    const k = `${m.de}|${m.para}|${m.percentualGrupo}`;
    if (!mapa.has(k)) mapa.set(k, { de: m.de, para: m.para,
      percentualGrupo: m.percentualGrupo, variacaoPreco: m.variacaoPreco || 0,
      valor: 0, lancamentos: 0, parceiros: new Set() });
    const g = mapa.get(k);
    g.valor += num(m.valorMigrado);
    g.lancamentos++;
    if (m.cnpj) g.parceiros.add(m.cnpj);
  }
  return [...mapa.values()].map((g) => ({ ...g, valor: r2(g.valor), parceiros: g.parceiros.size }));
}

/**
 * Drill-down: do grupo até o documento. Cada linha carrega o que sustenta o
 * número — classificação, CST, cClassTrib, base econômica, regra usada,
 * fração migrada e qual nível de premissa determinou cada campo.
 */
function drillDown(resultado, lado, dimensao, grupo, limite = 300) {
  const lista = (lado === 'compras' ? resultado.entradas : resultado.saidas)
    .filter((x) => x.grupos && x.grupos[dimensao] === grupo)
    .sort((a, b) => num(b.precoAtual) - num(a.precoAtual))
    .slice(0, limite);

  return lista.map((x) => ({
    movimento_id: x.movimento_id,
    documento: x.documento, item: x.item_numero,
    contraparte: x.contraparte, cnpj: x.cnpj,
    descricao: x.descricao, ncm: x.ncm, nbs: x.nbs, cfop: x.cfop,
    regime: lado === 'compras' ? x.regimeEmitente : x.regimeAdquirente,
    fracao: x.fracao === undefined ? 1 : x.fracao,
    migracao: x.migracao,
    precoAtual: r2(x.precoAtual), baseEconomica: r2(x.baseEconomica),
    formulaBase: x.reconstrucao ? x.reconstrucao.formula : '',
    statusBase: x.reconstrucao ? x.reconstrucao.status : '',
    cst: x.classificacao ? x.classificacao.cst : '',
    cclasstrib: x.classificacao ? x.classificacao.cclasstrib : '',
    tratamento: x.classificacao ? x.classificacao.tratamento : '',
    origemRegra: x.classificacao ? x.classificacao.origemRegra : '',
    fundamento: x.classificacao ? x.classificacao.fundamentoLegal : '',
    aliquotaIbs: x.aliquotas ? x.aliquotas.ibs : null,
    aliquotaCbs: x.aliquotas ? x.aliquotas.cbs : null,
    ibs: r2(x.ibs), cbs: r2(x.cbs),
    creditoIbs: r2(x.creditoIbs), creditoCbs: r2(x.creditoCbs),
    statusCredito: x.credito ? x.credito.status : '',
    motivoCredito: x.credito ? x.credito.motivo : '',
    custoLiquido: r2(x.custoLiquido),
    premissas: x.premissas || {},
    precedencia: explicarPrecedencia(x.premissas),
    natureza: x.natureza,
  }));
}

/**
 * Reconciliação: prova que a soma do detalhe bate com o agregado.
 * É o teste que sustenta a confiança no número consolidado.
 */
function reconciliar(resultado, lado) {
  const lista = lado === 'compras' ? resultado.entradas : resultado.saidas;
  const detalhe = {
    valor: lista.reduce((s, x) => s + num(x.precoAtual), 0),
    ibs: lista.reduce((s, x) => s + num(x.ibs), 0),
    cbs: lista.reduce((s, x) => s + num(x.cbs), 0),
    credito: lista.reduce((s, x) => s + num(x.creditoTotal), 0),
  };
  const conferencias = [];
  for (const d of Object.values(resultado.composicao[lado] || {})) {
    const agregado = d.grupos.reduce((s, g) => s + num(g.valor), 0);
    conferencias.push({
      dimensao: d.dimensao, nome: d.nome,
      somaGrupos: r2(agregado), somaDetalhe: r2(detalhe.valor),
      diferenca: r2(agregado - detalhe.valor),
      participacaoTotal: r6(d.grupos.reduce((s, g) => s + num(g.participacao), 0)),
      confere: Math.abs(agregado - detalhe.valor) < 0.05,
    });
  }
  return { detalhe: { valor: r2(detalhe.valor), ibs: r2(detalhe.ibs), cbs: r2(detalhe.cbs), credito: r2(detalhe.credito) },
    dimensoes: conferencias,
    confere: conferencias.every((c) => c.confere),
  };
}

/** Traduz a trilha de precedência para linguagem de interface */
const ROTULO_NIVEL = {
  individual: 'premissa individual',
  grupo: 'premissa de grupo',
  'migração (grupo)': 'migração do grupo',
  global: 'premissa global',
};
function explicarPrecedencia(premissas) {
  const out = [];
  for (const [campo, p] of Object.entries(premissas || {})) {
    if (campo === 'migracao_ignorada') {
      out.push({ campo, nivel: p.nivel, texto: p.texto
        || 'A premissa do grupo não foi aplicada a este item porque existe uma premissa individual com maior precedência.',
        natureza: p.natureza });
      continue;
    }
    out.push({ campo, nivel: p.nivel,
      texto: `${campo} definido por ${ROTULO_NIVEL[p.nivel] || p.nivel}: ${p.valor}${p.justificativa ? ` — ${p.justificativa}` : ''}`,
      natureza: p.natureza });
  }
  return out;
}

module.exports = { memoriaGrupo, drillDown, reconciliar, explicarPrecedencia };

/**
 * Consolidações oficiais do diagnóstico.
 *
 * Esta camada NÃO calcula tributos. Ela somente lê a última execução do
 * motor gravada em motor_resultados e a apresenta por cliente, fornecedor ou
 * cadeia. Assim, telas e relatórios não podem criar uma segunda base,
 * classificação, CBS ou crédito por agregação paralela.
 */
const db = require('../db');
const motorExec = require('./motorExec');
const perfilCbs = require('./perfilCbs');

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const r4 = (v) => Math.round(n(v) * 10000) / 10000;

function ultimaExecucao(empresaId, opcoes = {}) {
  let execucao = motorExec.ultimaExecucao(empresaId);
  if (!execucao && opcoes.executarSeAusente !== false) {
    motorExec.executar(empresaId, { ano: Number(opcoes.ano) || 2027 });
    execucao = motorExec.ultimaExecucao(empresaId);
  }
  return execucao;
}

function linhas(empresaId, opcoes = {}) {
  const execucao = ultimaExecucao(empresaId, opcoes);
  if (!execucao) return { execucao: null, linhas: [] };
  const dados = db.prepare(`SELECT r.*, m.competencia, m.documento, m.chave, m.descricao, m.ncm, m.nbs, m.cfop,
      m.nome, m.inscr_federal, m.tipo AS tipo_movimento, m.origem AS origem_movimento,
      COALESCE(NULLIF(p.regime,''), r.regime_cbs_emitente, 'indeterminado') AS regime_parceiro,
      p.descricao AS parceiro_cadastrado
    FROM motor_resultados r
    JOIN movimentos m ON m.id=r.movimento_id
    LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo AND p.cnpj=m.inscr_federal
    WHERE r.empresa_id=?
  ORDER BY r.preco_atual DESC, r.id`).all(empresaId).map((x) => {
    let detalhe = {}; try { detalhe = JSON.parse(x.detalhe || '{}'); } catch (_) { /* detalhe inválido vira pendência */ }
    return { ...x, detalhe };
  });
  return { execucao, linhas: dados };
}

function natureza(linha) {
  const d = linha.detalhe || {};
  if (['REQUER_VALIDACAO', 'SEM_CORRESPONDENCIA'].includes(linha.status_classificacao)
    || ['DADOS_INSUFICIENTES', 'SUJEITO_VALIDACAO'].includes(linha.status_credito)) return 'INDETERMINADO';
  if (String(linha.natureza || d.natureza).toUpperCase() === 'SIMULADO') return 'SIMULADO';
  if (d.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_natureza === 'REAL') return 'REAL';
  return 'CALCULADO';
}

function leituraCreditoFornecedor(linha) {
  if (linha.status_credito_determinacao === 'INDETERMINADO' || linha.status_credito === 'DADOS_INSUFICIENTES') return 'Crédito indeterminado — requer evidência';
  if (linha.status_credito === 'SEM_DIREITO') return 'Sem crédito — conclusão do motor';
  if (linha.status_credito_determinacao === 'DETERMINADO_POR_PREMISSA') return 'Crédito CBS estimado — premissa cadastrada';
  if (linha.tipo_credito === 'SIMPLES') return 'Crédito limitado CBS Simples';
  return 'Potencialmente relevante — crédito apropriável';
}

function leituraCliente(linha) {
  const s = linha.detalhe?.sensibilidade;
  if (s?.leitura) return s.leitura;
  if (linha.perfil_destinatario === 'b2c_pf') return 'Não aplicável — consumidor final';
  if (linha.perfil_destinatario === 'governo') return 'Preço cheio relevante — ente governamental';
  if (linha.status_credito === 'DADOS_INSUFICIENTES') return 'A validar';
  return 'Potencialmente relevante — B2B regular';
}

function grupoDaLinha(linha, lado) {
  const regime = linha.regime_parceiro || 'indeterminado';
  if (lado === 'cliente') {
    if (linha.perfil_destinatario === 'governo') return 'Governo';
    if (linha.perfil_destinatario === 'b2c_pf') return 'Pessoa Física';
    if (regime === 'simples_nacional') return 'Simples Nacional';
    if (regime === 'mei') return 'MEI';
  }
  return {
    lucro_real: 'Lucro Real', lucro_presumido: 'Lucro Presumido', regime_regular: 'Regime regular (não optante pelo Simples)',
    simples_nacional: 'Simples Nacional', simples_regime_regular: 'Simples Nacional (regime regular IBS/CBS)',
    mei: 'MEI',
    pessoa_fisica: 'Pessoa Física (consumidor final)', orgao_publico: 'Governo', imune_isento: 'Imune / Isento',
  }[regime] || 'Perfil desconhecido';
}

function cadeia(empresaId, tipo, opcoes = {}) {
  const lado = tipo === 'cliente' ? 'cliente' : 'fornecedor';
  const sentido = lado === 'cliente' ? 'saida' : 'entrada';
  const base = linhas(empresaId, opcoes);
  const itens = base.linhas.filter((x) => x.sentido === sentido);
  const porParceiro = new Map(), porGrupo = new Map();
  const total = { registros: itens.length, valor: 0, baseEconomica: 0, cbs: 0, ibs: 0, precoFinal: 0, custoLiquido: 0, credito: 0, pisCofinsAtual: 0, pisIndeterminado: false };

  const acumular = (destino, x) => {
    const d = x.detalhe || {}; const rec = d.reconstrucao || {};
    const pis = rec.memoriaPisCofins?.carga_atual_pis_cofins_valor;
    destino.itens = (destino.itens || 0) + 1;
    destino.valor = n(destino.valor) + n(x.preco_atual);
    destino.baseEconomica = n(destino.baseEconomica) + n(x.base_economica);
    destino.ibs = n(destino.ibs) + n(x.ibs);
    destino.cbs = n(destino.cbs) + n(x.cbs);
    destino.precoFinal = n(destino.precoFinal) + n(x.preco_projetado);
    destino.custoLiquido = n(destino.custoLiquido) + n(x.custo_liquido);
    // O débito CBS da saída existe independentemente do perfil do destinatário.
    // Já o crédito potencial é lido do resultado oficial de crédito: para PF e
    // perfis sem direito, ele permanece zero sem apagar a CBS da venda.
    destino.creditoPotencial = n(destino.creditoPotencial) + n(x.credito_cbs) + n(x.credito_ibs);
    destino.creditoFinal = n(destino.creditoFinal) + n(x.credito_cbs) + n(x.credito_ibs);
    destino.pisCofinsAtual = n(destino.pisCofinsAtual) + n(pis);
    destino.pisIndeterminado = Boolean(destino.pisIndeterminado || pis === null || pis === undefined);
    destino.naturezas = destino.naturezas || new Set(); destino.naturezas.add(natureza(x));
    destino.statusCredito = destino.statusCredito || new Set(); destino.statusCredito.add(x.status_credito_determinacao || x.status_credito || 'INDETERMINADO');
  };

  for (const x of itens) {
    const chave = x.inscr_federal || x.nome || `movimento:${x.movimento_id}`;
    const nome = x.parceiro_cadastrado || x.nome || x.detalhe?.contraparte || 'Sem identificação';
    if (!porParceiro.has(chave)) porParceiro.set(chave, { chave, cnpj: x.inscr_federal || '', nome, regime: x.regime_parceiro || 'indeterminado', regimeLabel: grupoDaLinha(x, lado), parceiros: 1 });
    acumular(porParceiro.get(chave), x);
    const grupo = grupoDaLinha(x, lado);
    if (!porGrupo.has(grupo)) porGrupo.set(grupo, { label: grupo, regime: x.regime_parceiro || 'indeterminado', parceirosSet: new Set() });
    const g = porGrupo.get(grupo); g.parceirosSet.add(chave); acumular(g, x);
    acumular(total, x);
  }

  const finalizar = (x) => ({ ...x,
    valor: r2(x.valor), baseEconomica: r2(x.baseEconomica), ibs: r2(x.ibs), cbs: r2(x.cbs), precoFinal: r2(x.precoFinal), custoLiquido: r2(x.custoLiquido),
    creditoPotencial: r2(x.creditoPotencial), creditoFinal: r2(x.creditoFinal), pisCofinsAtual: r2(x.pisCofinsAtual),
    impactoOperacao: r2(n(x.precoFinal) - n(x.valor)), impactoOperacaoPerc: x.valor ? r4((n(x.precoFinal) - n(x.valor)) / n(x.valor)) : null,
    relevanciaCreditoCliente: lado === 'cliente' ? leituraCliente(x._linha || {}) : leituraCreditoFornecedor(x._linha || {}),
    natureza: x.naturezas?.has('INDETERMINADO') ? 'INDETERMINADO' : x.naturezas?.has('SIMULADO') ? 'SIMULADO' : x.naturezas?.has('REAL') ? 'REAL' : 'CALCULADO',
  });
  // A leitura é fixa por grupo/parceiro a partir da primeira operação apenas; status agregado segue visível no drill-down.
  for (const x of porParceiro.values()) x._linha = itens.find((i) => (i.inscr_federal || i.nome || `movimento:${i.movimento_id}`) === x.chave);
  for (const x of porGrupo.values()) x._linha = itens.find((i) => grupoDaLinha(i, lado) === x.label);
  const parceiros = [...porParceiro.values()].map(finalizar).sort((a, b) => b.valor - a.valor);
  let acumulado = 0;
  for (const p of parceiros) { p.representatividade = total.valor ? r4(p.valor / total.valor) : 0; acumulado += p.representatividade; p.acumulado = r4(acumulado); p.classeAbc = acumulado <= .8 ? 'A' : acumulado <= .95 ? 'B' : 'C'; }
  const regimes = [...porGrupo.values()].map((x) => ({ ...finalizar(x), parceiros: x.parceirosSet.size, representatividade: total.valor ? r4(x.valor / total.valor) : 0 })).sort((a, b) => b.valor - a.valor);
  const detalhes = itens.map((x) => ({
    movimento_id: x.movimento_id, documento: x.documento || x.chave || '', parceiro: x.parceiro_cadastrado || x.nome || x.detalhe?.contraparte || '', cnpj: x.inscr_federal || '',
    produto: x.descricao || '', ncm: x.ncm || '', nbs: x.nbs || '', cfop: x.cfop || '', competencia: x.competencia || null,
    valor: r2(x.preco_atual), valorSemImposto: r2(x.base_economica), ibs: r2(x.ibs), cbs: r2(x.cbs), precoFinal: r2(x.preco_projetado),
    creditoCbs: r2(x.credito_cbs), creditoIbs: r2(x.credito_ibs), creditoPotencial: r2(n(x.credito_cbs) + n(x.credito_ibs)),
    pisCofinsAtual: x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_valor ?? null,
    origemPisCofins: x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_origem || 'INDETERMINADO',
    tributosRetirados: {
      // A memória de componentes retirados é distinta dos tributos apenas
      // identificados. Em CBS-only, ISS/ICMS ficam identificados, mas zerados
      // aqui porque não reduzem a base CBS.
      icms: r2(x.detalhe?.reconstrucao?.componentesRetirados?.icms ?? x.detalhe?.reconstrucao?.memoriaPisCofins?.tributos_retirados_da_base?.icms),
      iss: r2(x.detalhe?.reconstrucao?.componentesRetirados?.iss ?? x.detalhe?.reconstrucao?.memoriaPisCofins?.tributos_retirados_da_base?.iss),
      pis: r2(x.detalhe?.reconstrucao?.componentesRetirados?.pis ?? x.detalhe?.reconstrucao?.memoriaPisCofins?.tributos_retirados_da_base?.pis),
      cofins: r2(x.detalhe?.reconstrucao?.componentesRetirados?.cofins ?? x.detalhe?.reconstrucao?.memoriaPisCofins?.tributos_retirados_da_base?.cofins),
      total: r2(x.detalhe?.reconstrucao?.retiradosDaBase),
    },
    tributosIdentificados: x.detalhe?.reconstrucao?.tributosAtuais || {},
    memoriaTributos: x.detalhe?.reconstrucao?.memoriaTributos || {},
    formulaBaseEconomica: x.detalhe?.reconstrucao?.formula || 'Base econômica registrada pelo motor.',
    motivoBaseEconomica: x.detalhe?.reconstrucao?.memoriaPisCofins?.base_reconstrucao_metodo
      ? `PIS/COFINS: ${x.detalhe.reconstrucao.memoriaPisCofins.base_reconstrucao_metodo}${x.detalhe.reconstrucao.memoriaPisCofins.fundamento ? ` — ${x.detalhe.reconstrucao.memoriaPisCofins.fundamento}` : ''}`
      : (x.detalhe?.reconstrucao?.pendencias || []).join(' ') || 'Tributos atuais identificados conforme a memória do motor.',
    origemBaseEconomica: x.detalhe?.reconstrucao?.memoriaPisCofins?.base_reconstrucao_fonte
      || x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_origem || 'INDETERMINADO',
    statusBaseEconomica: x.detalhe?.reconstrucao?.status || 'INDETERMINADO',
    impactoOperacao: r2(n(x.preco_projetado) - n(x.preco_atual)), impactoOperacaoPerc: x.preco_atual ? r4((n(x.preco_projetado) - n(x.preco_atual)) / n(x.preco_atual)) : null,
    tipoCredito: x.tipo_credito, modalidadeCredito: x.modalidade_credito, statusCredito: x.status_credito_determinacao || x.status_credito,
    natureza: natureza(x), detalhe: x.detalhe,
  }));
  const t = finalizar(total); t.parceiros = parceiros.length;
  return { execucao: base.execucao, lado, totais: t, parceiros, regimes, detalhes,
    cenarios: [{ ano: base.execucao?.ano || 2027, valor: t.valor, baseEconomica: t.baseEconomica, ibs: t.ibs, cbs: t.cbs, precoFinal: t.precoFinal, credito: t.creditoFinal, creditoPotencial: t.creditoPotencial, impactoOperacao: t.impactoOperacao, impactoOperacaoPerc: t.impactoOperacaoPerc }],
    riscos: [], fonte: 'motor_resultados' };
}

function impactoFinal(empresaId, opcoes = {}) {
  const base = linhas(empresaId, opcoes); const saidas = base.linhas.filter((x) => x.sentido === 'saida'); const entradas = base.linhas.filter((x) => x.sentido === 'entrada');
  const soma = (lista, campo) => r2(lista.reduce((s, x) => s + n(x[campo]), 0));
  const cbsDebito = soma(saidas, 'cbs'); const cbsCredito = soma(entradas, 'credito_cbs');
  const receitaProjetada = soma(saidas, 'preco_projetado'); const baseSaidas = soma(saidas, 'base_economica');
  const pisDebitos = saidas.map((x) => x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_valor);
  const pisCreditos = entradas.map((x) => x.detalhe?.creditoAtual?.pisCofins);
  const pisIndeterminado = [...pisDebitos, ...pisCreditos].some((x) => x === null || x === undefined);
  const pisLiquido = pisIndeterminado ? null : r2(pisDebitos.reduce((s, x) => s + n(x), 0) - pisCreditos.reduce((s, x) => s + n(x), 0));
  const liquida = r2(cbsDebito - cbsCredito);
  const perfil = base.execucao ? perfilCbs.materializar(empresaId) : { competencias: [] };
  const pDebito = r2((perfil.competencias || []).reduce((s, x) => s + n(x.cbs_debito), 0));
  const pCredito = r2((perfil.competencias || []).reduce((s, x) => s + n(x.cbs_credito), 0));
  const tol = .01;
  const status = !base.execucao ? 'INCOMPLETO' : Math.abs(cbsDebito - pDebito) < tol && Math.abs(cbsCredito - pCredito) < tol ? 'RECONCILIADO' : 'DIVERGENTE';
  return { execucao: base.execucao, cbs_debito_vendas: cbsDebito, cbs_credito_compras: cbsCredito, cbs_liquida: liquida,
    receita_projetada: receitaProjetada, base_economica_saidas: baseSaidas,
    carga_efetiva_cbs_receita: receitaProjetada ? r4(liquida / receitaProjetada) : null,
    carga_efetiva_cbs_base: baseSaidas ? r4(liquida / baseSaidas) : null,
    pis_cofins_debitos_atuais: pisIndeterminado ? null : r2(pisDebitos.reduce((s, x) => s + n(x), 0)),
    pis_cofins_creditos_atuais: pisIndeterminado ? null : r2(pisCreditos.reduce((s, x) => s + n(x), 0)),
    pis_cofins_liquido_atual: pisLiquido, pis_cofins_indeterminado: pisIndeterminado,
    variacao_carga_federal: pisLiquido === null ? null : r2(liquida - pisLiquido), variacao_percentual: pisLiquido === null || !pisLiquido ? null : r4((liquida - pisLiquido) / Math.abs(pisLiquido)),
    credito_cbs_recebido_fornecedores: cbsCredito, credito_cbs_entregue_clientes: cbsDebito,
    reconciliacao: { status, disponivel: Boolean(base.execucao), itens: base.linhas.length, confere: status === 'RECONCILIADO',
      cbsDebitoVendas: pDebito, cbsCreditoCompras: pCredito,
      motor_resultados: { cbsDebito, cbsCredito }, perfil_cbs: { cbsDebito: pDebito, cbsCredito: pCredito },
      diferencaDebito: r2(cbsDebito - pDebito), diferencaCredito: r2(cbsCredito - pCredito) },
    drill_down: { clientes: 'clientes', fornecedores: 'fornecedores', memoria_atual: 'perfil' } };
}

module.exports = { linhas, cadeia, impactoFinal, ultimaExecucao };

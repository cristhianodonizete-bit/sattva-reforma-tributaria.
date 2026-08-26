/**
 * RELATÓRIOS EM EXCEL — entregáveis do produto
 */
const XLSX = require('xlsx');
const db = require('../db');
const P = require('../config/parametros');
const { CLAUSULAS } = require('../config/conteudo');
const motorExec = require('./motorExec');
const mapaRiscos = require('./mapaRiscos');
const consolidacaoOficial = require('./consolidacaoOficial');

const perc = (n) => (Number(n) || 0);
const arq = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);

function carregarMovimentos(empresaId, tipo) {
  return db.prepare(`SELECT m.*, COALESCE(NULLIF(m.regime,''), p.regime, 'lucro_real') regime,
      COALESCE(p.descricao, m.nome) nome, m.inscr_federal cnpj
    FROM movimentos m
    LEFT JOIN parceiros p ON p.empresa_id = m.empresa_id AND p.tipo = m.tipo AND p.cnpj = m.inscr_federal
    WHERE m.empresa_id = ? AND m.tipo = ?`).all(empresaId, tipo);
}

function chaveReferenciaServico(m) {
  const nbs = String(m.nbs || '').replace(/\D/g, '');
  return nbs ? `nbs:${nbs}` : `descricao:${String(m.descricao || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160)}`;
}

function encontrarReferenciaServico(m, mapa) {
  return mapa.get(chaveReferenciaServico(m))
    || mapa.get(chaveReferenciaServico({ descricao: m.descricao }))
    || null;
}

function ehServicoDeVenda(m) {
  return Boolean(String(m.nbs || '').replace(/\D/g, ''))
    || Number(m.iss || 0) !== 0
    || (!String(m.ncm || '').replace(/\D/g, '') && Boolean(String(m.descricao || '').trim()));
}
function requerReferenciaFiscalServico(m) {
  return ehServicoDeVenda(m) && (Number(m.pis || 0) + Number(m.cofins || 0) <= 0);
}

// Adapter de apresentação: reconstitui a estrutura esperada pelo mapa de
// riscos a partir do detalhe já persistido em motor_resultados. Não chama o
// motor nem calcula base, CBS, crédito ou classificação novamente.
function motorPersistido(empresaId) {
  const base = consolidacaoOficial.linhas(empresaId, { executarSeAusente: false });
  const empresa = db.prepare('SELECT * FROM empresas WHERE id=?').get(empresaId);
  const linhas = base.linhas.map((r) => ({ ...r.detalhe, movimento_id: r.movimento_id, sentido: r.sentido }));
  const entradas = linhas.filter((x) => x.sentido === 'entrada');
  const saidas = linhas.filter((x) => x.sentido === 'saida');
  const soma = (xs, campo) => xs.reduce((s, x) => s + (Number(x[campo]) || 0), 0);
  const apuracao = {
    ibs: { debitos: soma(saidas, 'ibs'), creditos: soma(entradas, 'creditoIbs') },
    cbs: { debitos: soma(saidas, 'cbs'), creditos: soma(entradas, 'creditoCbs') },
  };
  apuracao.ibs.saldo = apuracao.ibs.debitos - apuracao.ibs.creditos;
  apuracao.cbs.saldo = apuracao.cbs.debitos - apuracao.cbs.creditos;
  apuracao.cargaLiquida = apuracao.ibs.saldo + apuracao.cbs.saldo;
  return { empresa, ano: base.execucao?.ano || 2027, entradas, saidas, apuracao, resumo: {
    ano: base.execucao?.ano || 2027, itens: linhas.length, entradas: entradas.length, saidas: saidas.length,
    classificados: linhas.filter((x) => x.classificacao?.status === 'CLASSIFICADO').length,
    requerValidacao: linhas.filter((x) => x.classificacao?.status === 'REQUER_VALIDACAO').length,
    semCorrespondencia: linhas.filter((x) => x.classificacao?.status === 'SEM_CORRESPONDENCIA').length,
    simulados: linhas.filter((x) => x.natureza === 'SIMULADO').length,
    comprasAnalisadas: soma(entradas, 'precoAtual'), faturamentoAnalisado: soma(saidas, 'precoAtual'),
    baseEconomicaEntradas: soma(entradas, 'baseEconomica'), baseEconomicaSaidas: soma(saidas, 'baseEconomica'),
    apuracao, cargaAtual: { total: 0 }, comparacao: { cargaAtual: null, diferenca: null }, conformidade: [],
  }};
}

function prepararCadeia(empresaId, tipo) {
  let movimentos = carregarMovimentos(empresaId, tipo);
  if (tipo === 'cliente') {
    const refs = db.prepare('SELECT * FROM empresa_servicos_fiscais WHERE empresa_id=? AND ativo=1').all(empresaId);
    const mapa = new Map(refs.map((r) => [r.chave, r]));
    movimentos = movimentos.map((m) => ({ ...m, referenciaFiscal: encontrarReferenciaServico(m, mapa) }));
    // A ausência de referência é sinalizada na análise, mas não bloqueia o
    // relatório: documento, catálogo e regime continuam como fontes do motor.
  }
  const aliquotas = db.prepare('SELECT * FROM param_aliquotas ORDER BY ano').all();
  const ibsAtivo = aliquotas.some((a) => Number(a.calcular_ibs) === 1);
  const referencia = aliquotas.find((a) => Number(a.ano) === 2027) || aliquotas[0];
  return { movimentos, anos: ibsAtivo ? aliquotas.map((a) => Number(a.ano)) : [Number(referencia?.ano || 2027)],
    parametrosIVA: ibsAtivo ? Object.fromEntries(aliquotas.map((a) => [Number(a.ano), a])) : referencia };
}

function aba(wb, nome, dados, larguras) {
  const ws = XLSX.utils.json_to_sheet(dados.length ? dados : [{ 'Sem dados': '' }]);
  ws['!cols'] = larguras || Object.keys(dados[0] || { a: 1 }).map((k) => ({ wch: Math.max(14, String(k).length + 3) }));
  XLSX.utils.book_append_sheet(wb, ws, nome.slice(0, 31));
}

function gerar(empresaId, tipo, query = {}) {
  const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada');
  const wb = XLSX.utils.book_new();
  const repasse = query.repasse !== undefined ? Number(query.repasse) : 1;
  const referenciaCbs = db.prepare('SELECT * FROM param_aliquotas WHERE ano=2027').get() || {};

  // Relatórios finais leem a execução materializada do motor. Se as somas
  // oficiais não reconciliarem com o Perfil CBS, não emitimos um arquivo que
  // possa dar aparência de conclusão a um resultado divergente.
  const impactoOficial = consolidacaoOficial.impactoFinal(empresaId, { executarSeAusente: false });
  if (!impactoOficial.execucao) {
    throw new Error('Relatório bloqueado: não há fotografia oficial do motor. Reprocesse a empresa antes de emitir a entrega.');
  }
  if (impactoOficial.reconciliacao.status === 'DIVERGENTE') {
    throw new Error('Relatório bloqueado: a execução possui divergência material com o Perfil CBS. Revise a reconciliação antes de emitir a entrega.');
  }

  const capa = [
    { Campo: 'Empresa', Valor: empresa.razao_social },
    { Campo: 'CNPJ', Valor: empresa.cnpj },
    { Campo: 'Regime tributário', Valor: (P.REGIMES[empresa.regime] || {}).label || empresa.regime },
    { Campo: 'UF / Município', Valor: `${empresa.uf || '-'} / ${empresa.municipio || '-'}` },
    { Campo: 'Relatório', Valor: tipo },
    { Campo: 'Emissão', Valor: new Date().toLocaleString('pt-BR') },
    { Campo: 'Responsável', Valor: 'Sattva Controladoria — Implementação da Reforma Tributária' },
    { Campo: 'Alíquota de referência CBS', Valor: `${((Number(referenciaCbs.cbs) || 0) * 100).toFixed(2)}%` },
    { Campo: 'Alíquota de referência IBS', Valor: `${Number(referenciaCbs.calcular_ibs) === 1 ? ((Number(referenciaCbs.ibs) || 0) * 100).toFixed(2) : '0,00'}%` },
    { Campo: 'Grau de repasse simulado', Valor: `${(repasse * 100).toFixed(0)}%` },
  ];
  aba(wb, 'Capa', capa, [{ wch: 28 }, { wch: 70 }]);

  if (tipo === 'diagnostico' || tipo === 'fornecedores') {
    const a = consolidacaoOficial.cadeia(empresaId, 'fornecedor', { executarSeAusente: false });
    aba(wb, 'Fornecedores', a.parceiros.map((p) => ({
      'Fornecedor': p.nome, 'CNPJ': p.cnpj, 'Regime': p.regimeLabel, 'Itens': p.itens,
      'Valor': p.valor, 'Representatividade': perc(p.representatividade), 'Classe ABC': p.classeAbc,
      'Base econômica': p.baseEconomica, 'CBS da compra': p.cbs, 'Crédito CBS': p.creditoFinal,
      'Compra projetada': p.precoFinal, 'Impacto R$': p.impactoOperacao, 'Impacto %': perc(p.impactoOperacaoPerc),
    })));
    aba(wb, 'Compras por regime', a.regimes.map((r) => ({
      'Regime': r.label, 'Fornecedores': r.parceiros, 'Valor': r.valor, 'Participação': perc(r.representatividade),
      'Base econômica': r.baseEconomica, 'CBS da compra': r.cbs, 'Crédito potencial': r.creditoPotencial,
      'Compra projetada': r.precoFinal, 'Impacto R$': r.impactoOperacao,
    })));
    aba(wb, 'Cenarios compras', a.cenarios.map((c) => ({
      'Referência': c.ano, 'Valor de compras': c.valor, 'Base econômica': c.baseEconomica, 'CBS': c.cbs,
      'Crédito CBS': c.credito, 'Compra projetada': c.precoFinal, 'Impacto': c.impactoOperacao,
    })));
    aba(wb, 'Riscos compras', a.riscos.map((r) => ({ 'Nível': r.nivel, 'Risco': r.titulo, 'Descrição': r.texto, 'Ação recomendada': r.acao })),
      [{ wch: 10 }, { wch: 45 }, { wch: 80 }, { wch: 80 }]);
  }

  if (tipo === 'diagnostico' || tipo === 'clientes') {
    const a = consolidacaoOficial.cadeia(empresaId, 'cliente', { executarSeAusente: false });
    aba(wb, 'Clientes', a.parceiros.map((p) => ({
      'Cliente': p.nome, 'CNPJ/CPF': p.cnpj, 'Perfil': p.regimeLabel, 'Itens': p.itens,
      'Venda atual': p.valor, 'Representatividade': perc(p.representatividade), 'Classe ABC': p.classeAbc,
      'Base econômica': p.baseEconomica, 'PIS/COFINS atual': p.pisCofinsAtual,
      'IBS da venda': p.ibs, 'CBS da venda': p.cbs, 'Venda projetada': p.precoFinal,
      'Impacto da venda R$': p.impactoOperacao, 'Impacto da venda %': perc(p.impactoOperacaoPerc),
      'Crédito potencial da operação': p.creditoPotencial, 'Relevância para o cliente': p.relevanciaCreditoCliente,
    })));
    aba(wb, 'Carteira por perfil', a.regimes.map((r) => ({
      'Perfil': r.label, 'Clientes': r.parceiros, 'Venda atual': r.valor, 'Participação': perc(r.representatividade),
      'Base econômica': r.baseEconomica, 'PIS/COFINS atual': r.pisCofinsAtual,
      'IBS da venda': r.ibs, 'CBS da venda': r.cbs, 'Venda projetada': r.precoFinal,
      'Impacto da venda': r.impactoOperacao, 'Crédito potencial': r.creditoPotencial,
      'Relevância para o cliente': r.relevanciaCreditoCliente,
    })));
    aba(wb, 'Cenarios vendas', a.cenarios.map((c) => ({
      'Referência': c.ano, 'Venda atual': c.valor, 'Base econômica': c.baseEconomica,
      'IBS da venda': c.ibs, 'CBS da venda': c.cbs, 'Venda projetada': c.precoFinal,
      'Impacto da venda': c.impactoOperacao, 'Impacto %': perc(c.impactoOperacaoPerc),
    })));
    aba(wb, 'Rastreabilidade vendas', a.detalhes.map((d) => ({
      'Cliente': d.parceiro, 'CNPJ/CPF': d.cnpj, 'Perfil': d.regime,
      'Produto/serviço': d.produto, 'NCM/NBS': d.ncm || d.nbs,
      'Venda atual': d.valor, 'PIS/COFINS atual': d.pisCofinsAtual,
      'Origem PIS/COFINS': d.origemPisCofins, 'Base econômica': d.valorSemImposto,
      'IBS da venda': d.ibs, 'CBS da venda': d.cbs, 'Venda projetada': d.precoFinal,
      'Impacto da venda': d.impactoOperacao, 'Impacto da venda %': perc(d.impactoOperacaoPerc),
    })));
    aba(wb, 'Riscos carteira', a.riscos.map((r) => ({ 'Nível': r.nivel, 'Risco': r.titulo, 'Descrição': r.texto, 'Ação recomendada': r.acao })),
      [{ wch: 10 }, { wch: 45 }, { wch: 80 }, { wch: 80 }]);
  }

  if (tipo === 'diagnostico' || tipo === 'precificacao') {
    // Relatório comercial: não lê a tabela legada itens_precificacao. A fonte
    // fiscal é a saída oficial materializada; a formação só informa cobertura.
    const itens = db.prepare(`SELECT i.id,i.descricao,i.codigo,i.tipo,i.movimento_saida_id,i.status_formacao_custo,
      r.preco_atual,r.base_economica,r.cbs,r.ibs,r.preco_projetado,r.tratamento,r.cst,r.cclasstrib,r.natureza,
      COUNT(c.id) componentes
      FROM formacao_custo_itens i
      LEFT JOIN motor_resultados r ON r.empresa_id=i.empresa_id AND r.movimento_id=i.movimento_saida_id
      LEFT JOIN formacao_custo_componentes c ON c.item_formacao_id=i.id
      WHERE i.empresa_id=? GROUP BY i.id ORDER BY i.descricao,i.id`).all(empresaId);
    aba(wb, 'Precificacao', itens.map((i) => ({
      'Item': i.descricao, 'Código': i.codigo, 'Tipo': i.tipo,
      'Movimento de saída oficial': i.movimento_saida_id || 'NÃO VINCULADO',
      'Cobertura da formação': i.movimento_saida_id && i.componentes ? i.status_formacao_custo : 'INCOMPLETO',
      'Componentes cadastrados': i.componentes,
      'Preço atual (motor)': i.preco_atual, 'Base econômica (motor)': i.base_economica,
      'CBS (motor)': i.cbs, 'IBS (motor)': i.ibs, 'Preço projetado (motor)': i.preco_projetado,
      'Tratamento (motor)': i.tratamento, 'CST (motor)': i.cst, 'cClassTrib (motor)': i.cclasstrib,
      'Natureza (motor)': i.natureza,
    })));
  }

  if (tipo === 'diagnostico' || tipo === 'contratos') {
    const contratos = db.prepare('SELECT * FROM contratos WHERE empresa_id = ?').all(empresaId);
    aba(wb, 'Contratos', contratos.map((c) => ({
      'Tipo': c.tipo, 'Contraparte': c.contraparte, 'CNPJ': c.cnpj_contraparte,
      'Regime': (P.REGIMES[c.regime_contraparte] || {}).label || c.regime_contraparte,
      'Objeto': c.objeto, 'Valor': c.valor, 'Vigência': `${c.vigencia_inicio} a ${c.vigencia_fim}`,
      'Preço com tributo incluso': c.preco_com_tributo ? 'Sim' : 'Não',
      'Status': c.status, 'Risco': c.risco, 'Parecer': c.parecer,
    })));
    const check = db.prepare(`SELECT cc.*, c.contraparte FROM contrato_checklist cc
      JOIN contratos c ON c.id = cc.contrato_id WHERE c.empresa_id = ?`).all(empresaId);
    aba(wb, 'Checklist contratual', check.map((k) => {
      const cl = CLAUSULAS.find((x) => x.id === k.clausula_id) || {};
      return { 'Contrato': k.contraparte, 'Cláusula': cl.titulo || k.clausula_id, 'Risco': cl.risco || '',
        'Situação': k.situacao, 'Observação': k.observacao || '', 'Texto sugerido': cl.texto || '' };
    }), [{ wch: 30 }, { wch: 50 }, { wch: 10 }, { wch: 14 }, { wch: 40 }, { wch: 110 }]);
  }

  if (tipo === 'diagnostico' || tipo === 'plano') {
    const acoes = db.prepare('SELECT * FROM acoes WHERE empresa_id = ?').all(empresaId);
    aba(wb, 'Plano de adequacao', acoes.map((a) => ({
      'Prioridade': a.prioridade, 'Origem': a.origem, 'Ação': a.titulo, 'Descrição': a.descricao,
      'Responsável': a.responsavel, 'Prazo': a.prazo, 'Status': a.status,
    })), [{ wch: 12 }, { wch: 18 }, { wch: 45 }, { wch: 70 }, { wch: 22 }, { wch: 14 }, { wch: 12 }]);
  }

  // ==================== RELATÓRIO TÉCNICO E MAPA DE RISCOS ====================
  // Alimentados exclusivamente pela fotografia materializada do motor.
  if (['tecnico', 'riscos', 'diagnostico', 'recomendacoes'].includes(tipo)) {
    let m = null;
    try { m = motorPersistido(empresaId); }
    catch (e) { aba(wb, 'Motor', [{ 'Situação': `Fotografia oficial não pôde ser lida: ${e.message}` }], [{ wch: 100 }]); }

    if (m) {
      const forn = motorExec.porFornecedor(m);
      const cli = motorExec.porCliente(m);
      const mapa = mapaRiscos.montar(m, { fornecedores: forn, clientes: cli });
      const R = m.resumo, ap = R.apuracao;

      if (tipo === 'tecnico' || tipo === 'diagnostico') {
        aba(wb, 'Sumário técnico', [
          { Indicador: 'Ano projetado', Valor: R.ano },
          { Indicador: 'Itens analisados', Valor: R.itens },
          { Indicador: 'Entradas / saídas', Valor: `${R.entradas} / ${R.saidas}` },
          { Indicador: 'Itens classificados', Valor: R.classificados },
          { Indicador: 'Itens que requerem validação', Valor: R.requerValidacao },
          { Indicador: 'Itens sem correspondência', Valor: R.semCorrespondencia },
          { Indicador: 'Itens com resultado simulado', Valor: R.simulados },
          { Indicador: 'Compras analisadas', Valor: R.comprasAnalisadas },
          { Indicador: 'Base econômica das entradas', Valor: R.baseEconomicaEntradas },
          { Indicador: 'Faturamento analisado', Valor: R.faturamentoAnalisado },
          { Indicador: 'Base econômica das saídas', Valor: R.baseEconomicaSaidas },
          { Indicador: 'Débito IBS projetado', Valor: ap.ibs.debitos },
          { Indicador: 'Crédito IBS projetado', Valor: ap.ibs.creditos },
          { Indicador: 'Saldo IBS projetado', Valor: ap.ibs.saldo },
          { Indicador: 'Débito CBS projetado', Valor: ap.cbs.debitos },
          { Indicador: 'Crédito CBS projetado', Valor: ap.cbs.creditos },
          { Indicador: 'Saldo CBS projetado', Valor: ap.cbs.saldo },
          { Indicador: 'Carga líquida IBS + CBS', Valor: ap.cargaLiquida },
          { Indicador: 'Carga atual identificada', Valor: R.comparacao.cargaAtual },
          { Indicador: 'Diferença', Valor: R.comparacao.diferenca },
          { Indicador: 'Observação', Valor: ap.observacao },
        ], [{ wch: 34 }, { wch: 46 }]);

        aba(wb, 'Projecao fornecedores', forn.map((f) => ({
          'Fornecedor': f.fornecedor, 'CNPJ': f.cnpj,
          'Regime': f.regime ? ((P.REGIMES[f.regime] || {}).label || f.regime) : 'NÃO CADASTRADO',
          'Itens': f.itens, 'Compras atuais': f.comprasAtuais, 'Base econômica': f.baseEconomica,
          'IBS projetado': f.ibs, 'CBS projetada': f.cbs,
          'Crédito IBS': f.creditoIbs, 'Crédito CBS': f.creditoCbs, 'Crédito total': f.creditoTotal,
          'Custo líquido projetado': f.custoLiquido,
          'Custo líquido / preço': f.comprasAtuais ? f.custoLiquido / f.comprasAtuais : 0,
          'Pendências': f.pendencias,
        })));

        aba(wb, 'Projecao clientes', cli.map((c) => ({
          'Cliente': c.cliente, 'CNPJ': c.cnpj,
          'Perfil': c.perfil || '—',
          'Regime': c.regime ? ((P.REGIMES[c.regime] || {}).label || c.regime) : 'NÃO CADASTRADO',
          'Itens': c.itens, 'Faturamento': c.faturamento, 'Base econômica': c.baseEconomica,
          'IBS': c.ibs, 'CBS': c.cbs, 'Crédito entregue': c.creditoEntregue,
          'Custo líquido p/ cliente': c.custoLiquidoCliente,
          'Importância potencial do crédito': c.sensibilidade || '—',
          'Pendências': c.pendencias,
        })));

        // Item 40 — rastreabilidade item a item
        aba(wb, 'Classificacoes', [...m.entradas, ...m.saidas].map((x) => ({
          'Sentido': x.sentido, 'Documento': x.documento, 'Item': x.item_numero,
          'Contraparte': x.contraparte, 'CNPJ': x.cnpj,
          'Regime da contraparte': x.sentido === 'entrada' ? (x.regimeEmitente || 'NÃO CADASTRADO') : (x.regimeAdquirente || 'NÃO CADASTRADO'),
          'Produto/serviço': x.descricao, 'NCM': x.ncm, 'NBS': x.nbs, 'CFOP': x.cfop,
          'CST atual': x.cstAtual || x.csosn,
          'Preço atual': x.precoAtual,
          'Base econômica': x.baseEconomica,
          'Status da base': x.reconstrucao.status,
          'Fórmula': x.reconstrucao.formula,
          'CST IBS/CBS': x.classificacao.cst,
          'cClassTrib': x.classificacao.cclasstrib,
          'Tratamento': x.classificacao.tratamento,
          'Origem da regra': x.classificacao.origemRegra,
          'Fundamento legal': x.classificacao.fundamentoLegal,
          'Alíquota IBS': x.aliquotas.ibs, 'Alíquota CBS': x.aliquotas.cbs,
          'IBS': x.ibs, 'CBS': x.cbs,
          'Crédito IBS': x.creditoIbs, 'Crédito CBS': x.creditoCbs,
          'Status do crédito': x.credito.status, 'Motivo': x.credito.motivo,
          'Preço projetado': x.precoProjetado, 'Custo líquido': x.custoLiquido,
          'Status da classificação': x.classificacao.status,
          'Natureza do dado': x.natureza,
        })), Array(30).fill({ wch: 18 }));

        aba(wb, 'Conformidade', (R.conformidade || []).flatMap((c) =>
          c.exemplos.map((e) => ({
            'Gravidade': c.gravidade, 'Apontamento': c.rotulo,
            'Itens no grupo': c.itens, 'Valor do grupo': c.valor,
            'Sentido': e.sentido, 'Parceiro': e.parceiro, 'CNPJ': e.cnpj,
            'Item': e.item, 'NCM/NBS': e.ncm || e.nbs, 'Documento': e.documento, 'Valor': e.valor,
            'Descrição': e.descricao,
          }))), [{ wch: 12 }, { wch: 42 }, { wch: 14 }, { wch: 16 }, { wch: 10 },
            { wch: 30 }, { wch: 18 }, { wch: 34 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 60 }]);
      }

      if (tipo === 'riscos' || tipo === 'diagnostico') {
        aba(wb, 'Mapa de riscos', mapa.riscos.map((x) => ({
          'Nível': x.nivel, 'Dimensão': x.dimensao, 'Risco': x.titulo,
          'Valor exposto': x.exposicao, 'Participação': x.participacao, 'Itens': x.itens,
          'Descrição': x.descricao, 'Impacto': x.impacto, 'Ação recomendada': x.acao,
        })), [{ wch: 9 }, { wch: 17 }, { wch: 48 }, { wch: 16 }, { wch: 13 }, { wch: 8 },
          { wch: 80 }, { wch: 70 }, { wch: 80 }]);

        aba(wb, 'Riscos - evidencias', mapa.riscos.flatMap((x) =>
          (x.evidencias || []).map((e) => ({
            'Risco': x.titulo, 'Nível': x.nivel,
            'Contraparte': e.contraparte, 'CNPJ': e.cnpj || '',
            'Documento': e.documento || '', 'Item': e.item || '',
            'NCM/NBS': e.ncm || '', 'Valor': e.valor, 'Detalhe': e.detalhe || '',
          }))), [{ wch: 48 }, { wch: 9 }, { wch: 32 }, { wch: 18 }, { wch: 14 },
            { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 60 }]);
      }

      if (tipo === 'recomendacoes') {
        aba(wb, 'Recomendações iniciais', mapa.riscos.map((x, indice) => ({
          'Prioridade': indice + 1,
          'Nível': x.nivel,
          'Dimensão': x.dimensao,
          'Achado': x.titulo,
          'Descrição': x.descricao,
          'Impacto': x.impacto,
          'Recomendação': x.acao,
          'Valor exposto': x.exposicao,
          'Depende de validação': (x.evidencias || []).some((e) => /pend|indetermin|valid/i.test(String(e.detalhe || ''))) ? 'Sim' : 'Não',
        })), [{ wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 48 }, { wch: 75 }, { wch: 75 }, { wch: 75 }, { wch: 18 }, { wch: 22 }]);
        aba(wb, 'Nota metodológica', [{
          'Leitura': 'As recomendações são derivadas dos documentos importados e do mapa de riscos do motor.',
          'Uso': 'Itens sem cadastro, classificação ou regime confirmado devem ser validados antes de decisão fiscal definitiva.',
        }], [{ wch: 110 }, { wch: 110 }]);
      }
    }
  }

  aba(wb, 'Cronograma', P.ANOS.map((ano) => {
    const c = P.CRONOGRAMA[ano];
    return { 'Ano': ano, 'CBS': c.cbs, 'IBS': c.ibs, 'IVA total': c.cbs + c.ibs,
      'ICMS/ISS vigentes': c.fatorIcmsIss, 'PIS/COFINS vigentes': c.fatorPisCofins, 'IPI vigente': c.fatorIpi,
      'Marco': c.nota };
  }), [{ wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 120 }]);

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const nome = `${arq(empresa.cnpj)} - ${arq(empresa.razao_social)} - ${tipo}.xlsx`;
  return { buffer, nome };
}

module.exports = { gerar };

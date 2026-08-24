/**
 * RELATÓRIOS EM EXCEL — entregáveis do produto
 */
const XLSX = require('xlsx');
const db = require('../db');
const P = require('../config/parametros');
const { analisarCadeia } = require('../engine/cadeia');
const { CLAUSULAS } = require('../config/conteudo');
const motorExec = require('./motorExec');
const mapaRiscos = require('./mapaRiscos');

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

function ehServicoDeVenda(m) {
  return Boolean(String(m.nbs || '').replace(/\D/g, ''))
    || Number(m.iss || 0) !== 0
    || (!String(m.ncm || '').replace(/\D/g, '') && Boolean(String(m.descricao || '').trim()));
}

function prepararCadeia(empresaId, tipo) {
  let movimentos = carregarMovimentos(empresaId, tipo);
  if (tipo === 'cliente') {
    const refs = db.prepare('SELECT * FROM empresa_servicos_fiscais WHERE empresa_id=? AND ativo=1').all(empresaId);
    const mapa = new Map(refs.map((r) => [r.chave, r]));
    movimentos = movimentos.map((m) => ({ ...m, referenciaFiscal: mapa.get(chaveReferenciaServico(m)) || null }));
    const pendentes = movimentos.filter((m) => ehServicoDeVenda(m) && !m.referenciaFiscal);
    if (pendentes.length) throw new Error(`${pendentes.length} serviço(s) de venda exigem referência fiscal antes da emissão do relatório.`);
  }
  const aliquotas = db.prepare('SELECT * FROM param_aliquotas ORDER BY ano').all();
  const ibsAtivo = aliquotas.some((a) => Number(a.calcular_ibs) === 1);
  const referencia = aliquotas.find((a) => Number(a.ano) === 2033) || aliquotas[aliquotas.length - 1];
  return { movimentos, anos: ibsAtivo ? aliquotas.map((a) => Number(a.ano)) : [Number(referencia?.ano || 2033)],
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
  const referenciaCbs = db.prepare('SELECT * FROM param_aliquotas WHERE ano=2033').get() || {};

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
    const cfg = prepararCadeia(empresaId, 'fornecedor');
    const a = analisarCadeia(cfg.movimentos, { regimeEmpresa: empresa.regime, lado: 'fornecedor', anos: cfg.anos, parametrosIVA: cfg.parametrosIVA, grauRepasse: repasse });
    aba(wb, 'Fornecedores', a.parceiros.map((p) => ({
      'Fornecedor': p.nome, 'CNPJ': p.cnpj, 'Regime': p.regimeLabel, 'Itens': p.itens,
      'Valor': p.valor, 'Representatividade': perc(p.representatividade), 'Classe ABC': p.classeAbc,
      'Tributos hoje': p.tributos, 'Crédito hoje': p.creditoHoje, 'Custo efetivo hoje': p.custoHoje,
      'Custo efetivo projetado': p.custoFinal, 'Variação R$': p.variacaoCusto, 'Variação %': perc(p.variacaoCustoPerc),
    })));
    aba(wb, 'Compras por regime', a.regimes.map((r) => ({
      'Regime': r.label, 'Fornecedores': r.parceiros, 'Valor': r.valor, 'Participação': perc(r.representatividade),
      'Crédito hoje': r.creditoHoje, 'Crédito potencial': r.creditoPotencial, 'Variação de crédito': r.variacaoCredito,
      'Custo hoje': r.custoHoje, 'Custo projetado': r.custoFinal, 'Variação de custo': r.variacaoCusto,
    })));
    aba(wb, 'Cenarios compras', a.cenarios.map((c) => ({
      'Ano': c.ano, 'Valor de compras': c.valor, 'Tributos': c.tributos, 'Créditos': c.credito,
      'Custo efetivo': c.custoEfetivo, 'Carga efetiva': perc(c.cargaEfetiva),
      'Variação de custo': c.variacaoCusto, 'Variação %': perc(c.variacaoCustoPerc), 'Marco': c.nota,
    })));
    aba(wb, 'Riscos compras', a.riscos.map((r) => ({ 'Nível': r.nivel, 'Risco': r.titulo, 'Descrição': r.texto, 'Ação recomendada': r.acao })),
      [{ wch: 10 }, { wch: 45 }, { wch: 80 }, { wch: 80 }]);
  }

  if (tipo === 'diagnostico' || tipo === 'clientes') {
    const cfg = prepararCadeia(empresaId, 'cliente');
    const a = analisarCadeia(cfg.movimentos, { regimeEmpresa: empresa.regime, lado: 'cliente', anos: cfg.anos, parametrosIVA: cfg.parametrosIVA, grauRepasse: repasse });
    aba(wb, 'Clientes', a.parceiros.map((p) => ({
      'Cliente': p.nome, 'CNPJ/CPF': p.cnpj, 'Perfil': p.regimeLabel, 'Itens': p.itens,
      'Venda atual': p.valor, 'Representatividade': perc(p.representatividade), 'Classe ABC': p.classeAbc,
      'Venda sem PIS/COFINS': p.baseEconomica, 'PIS/COFINS atual': p.pisCofinsAtual,
      'IBS da venda': p.ibs, 'CBS da venda': p.cbs, 'Venda projetada': p.precoFinal,
      'Impacto da venda R$': p.impactoOperacao, 'Impacto da venda %': perc(p.impactoOperacaoPerc),
      'Crédito potencial da operação': p.creditoPotencial, 'Relevância para o cliente': p.relevanciaCreditoCliente,
    })));
    aba(wb, 'Carteira por perfil', a.regimes.map((r) => ({
      'Perfil': r.label, 'Clientes': r.parceiros, 'Venda atual': r.valor, 'Participação': perc(r.representatividade),
      'Venda sem PIS/COFINS': r.baseEconomica, 'PIS/COFINS atual': r.pisCofinsAtual,
      'IBS da venda': r.ibs, 'CBS da venda': r.cbs, 'Venda projetada': r.precoProjetado,
      'Impacto da venda': r.impactoOperacao, 'Crédito potencial': r.creditoPotencial,
      'Relevância para o cliente': r.relevanciaCreditoCliente,
    })));
    aba(wb, 'Cenarios vendas', a.cenarios.map((c) => ({
      'Referência': c.ano, 'Venda atual': c.valor, 'Base econômica': c.baseEconomica,
      'IBS da venda': c.ibs, 'CBS da venda': c.cbs, 'Venda projetada': c.precoFinal,
      'Impacto da venda': c.impactoOperacao, 'Impacto %': perc(c.impactoOperacaoPerc),
    })));
    aba(wb, 'Riscos carteira', a.riscos.map((r) => ({ 'Nível': r.nivel, 'Risco': r.titulo, 'Descrição': r.texto, 'Ação recomendada': r.acao })),
      [{ wch: 10 }, { wch: 45 }, { wch: 80 }, { wch: 80 }]);
  }

  if (tipo === 'diagnostico' || tipo === 'precificacao') {
    const itens = db.prepare('SELECT * FROM itens_precificacao WHERE empresa_id = ?').all(empresaId)
      .map((i) => ({ ...i, r: i.resultado ? JSON.parse(i.resultado) : null })).filter((i) => i.r);
    aba(wb, 'Precificacao', itens.map((i) => ({
      'Item': i.descricao, 'NCM': i.ncm, 'Tipo': i.tipo, 'Ano': i.ano,
      'Preço hoje': i.r.hoje.preco, 'Preço sem imposto': i.r.hoje.precoSemImposto,
      'Carga hoje': perc(i.r.hoje.cargaEfetiva), 'Margem hoje R$': i.r.hoje.margem, 'Margem hoje %': perc(i.r.hoje.margemPerc),
      'Margem s/ reajuste R$': i.r.precoCongelado.margem, 'Margem s/ reajuste %': perc(i.r.precoCongelado.margemPerc),
      'Perda de margem': i.r.precoCongelado.variacaoMargem,
      'Preço neutro': i.r.precoNeutro.preco, 'Reajuste necessário': perc(i.r.precoNeutro.reajusteNecessario),
      'Perfil do cliente': i.r.cliente.label, 'Cliente credita': i.r.cliente.credita ? 'Sim' : 'Não',
      'Impacto p/ cliente %': perc(i.r.cliente.variacaoPerc),
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
  // Alimentados pelo motor de projeção, não pela análise agregada anterior.
  if (['tecnico', 'riscos', 'diagnostico', 'recomendacoes'].includes(tipo)) {
    let m = null;
    try { m = motorExec.executar(empresaId, { ano: query.ano, gravar: false }); }
    catch (e) { aba(wb, 'Motor', [{ 'Situação': `Motor não pôde ser executado: ${e.message}` }], [{ wch: 100 }]); }

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

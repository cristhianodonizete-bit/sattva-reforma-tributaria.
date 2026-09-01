/**
 * EXECUÇÃO DO MOTOR
 * ---------------------------------------------------------------------------
 * Roda a projeção sobre toda a movimentação da empresa e consolida os
 * resultados que alimentam as telas já existentes (item 42):
 *   Fornecedores · Clientes · Cenários · Classificações · Conformidade
 *   Simulações tributárias · Mapa de riscos · Plano de adequação
 *
 * Não cria produto novo: apenas conecta dados atuais + perfil + bases + motores.
 */
const db = require('../db');
const motor = require('../engine/motor');
const { simplesEfetivo } = require('../engine/reconstrucao');
const regras = require('./regras');
const excecoesMotor = require('./excecoesMotor');
const autonomiaTelemetry = require('./autonomiaTelemetry');
const { avaliarDimensoes } = require('./autonomiaDimensoes');
const pendenciasEnriquecimento = require('./pendenciasEnriquecimento');
const crypto = require('crypto');

// A versão é gravada em cada resultado para permitir invalidar apenas as
// operações afetadas. Não é usada como regra fiscal; apenas rastreabilidade.
const MOTOR_VERSION = 'motor-cbs-2026-08-25';
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);
const versoesAtuais = () => {
  const params = regras.tudo();
  return { regra_version: hash(params), parametro_version: hash(params.regimes || params), catalogo_version: 'catalogo-local-v1', motor_version: MOTOR_VERSION };
};
const hashMovimento = (m) => hash({
  id: m.id, valor: m.valor, base_calculo: m.base_calculo, icms: m.icms, icms_st: m.icms_st, ipi: m.ipi,
  pis: m.pis, cofins: m.cofins, iss: m.iss, ncm: m.ncm, nbs: m.nbs, cfop: m.cfop, cst: m.cst,
  csosn: m.csosn, regime: m.regime, inscr_federal: m.inscr_federal, data_emissao: m.data_emissao,
  descricao: m.descricao, quantidade: m.quantidade, desconto: m.desconto, frete: m.frete,
  // Estes campos são derivados do catálogo/base de classificação. Incluí-los
  // no hash faz com que uma reclassificação efetivamente invalide apenas os
  // movimentos afetados, sem depender de um recálculo integral.
  reducao: m.reducao, cclasstrib: m.cclasstrib, classificacao_origem: m.classificacao_origem,
});
const hashParceiro = (p) => hash({
  // Nos joins de movimento os aliases evitam colidir com descricao/regime
  // da própria operação; no cadastro puro os nomes originais são usados.
  regime: p?.regime_cadastro ?? p?.regime ?? null,
  perfil_economico: p?.perfil_cadastro ?? p?.perfil_economico ?? null,
  descricao: p?.nome_cadastro ?? p?.descricao ?? null,
  cnpj: p?.cnpj_cadastro ?? p?.cnpj ?? null,
  uf: p?.uf_parceiro ?? p?.uf ?? null,
});

// Assinatura das dependências realmente usadas por uma operação. A versão
// global continua disponível para auditoria, mas não serve como gatilho da
// rotina incremental: uma premissa exclusiva do Simples não deve refazer a
// carteira de fornecedor regular.
function versoesDaOperacao(movimento, parceiro) {
  const p = regras.tudo();
  const regime = parceiro?.regime_cadastro ?? parceiro?.regime ?? movimento.regime ?? 'indeterminado';
  const cfop = String(movimento.cfop || '').replace(/\D/g, '');
  const regrasCfop = (p.cfop || []).filter((x) => cfop && cfop.startsWith(String(x.prefixo || '').replace(/\D/g, '')));
  const regimeConfigurado = (p.regimes || []).find((x) => x.chave === regime) || null;
  const reducaoConfigurada = (p.reducoes || []).find((x) => x.chave === (movimento.reducao || 'integral')) || null;
  const regra = {
    tributos: p.tributos,
    reducao: reducaoConfigurada,
    cfop: regrasCfop,
    // A regra do regime da contraparte é a única regra de regime usada nesta
    // operação; os demais regimes não devem invalidá-la.
    regime: regimeConfigurado,
  };
  const parametro = {
    // CBS/IBS afetam toda operação, portanto a versão é compartilhada quando
    // essa tabela muda. Parâmetros do Simples só entram em linhas do Simples.
    aliquotas: p.aliquotas,
    simples: ['simples_nacional', 'mei'].includes(regime) ? p.simples : null,
    credito_simples: regime === 'simples_nacional'
      ? ((p.regimes || []).find((x) => x.chave === 'simples_nacional')?.creditoCbsSimplesReferencia ?? null) : null,
  };
  return {
    regra_version: hash(regra),
    parametro_version: hash(parametro),
    // A classificação efetiva (NCM/NBS/cClassTrib/redução) integra o hash do
    // movimento. Assim catálogo sem reflexo naquela classificação não invalida
    // a operação, enquanto uma reclassificação efetiva a invalida.
    catalogo_version: hash({ ncm: movimento.ncm, nbs: movimento.nbs, cclasstrib: movimento.cclasstrib, reducao: movimento.reducao, origem: movimento.classificacao_origem }),
    parceiro_version: hashParceiro(parceiro),
    motor_version: MOTOR_VERSION,
  };
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const chaveReferenciaServico = (m) => {
  const nbs = String(m.nbs || '').replace(/\D/g, '');
  return nbs ? `nbs:${nbs}` : `descricao:${String(m.descricao || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160)}`;
};
const encontrarReferenciaServico = (m, mapa) => mapa.get(chaveReferenciaServico(m))
  || mapa.get(chaveReferenciaServico({ descricao: m.descricao }))
  || null;
const ehServicoDeVenda = (m) => Boolean(String(m.nbs || '').replace(/\D/g, ''))
  || Number(m.iss || 0) !== 0
  || (!String(m.ncm || '').replace(/\D/g, '') && Boolean(String(m.descricao || '').trim()));
const requerReferenciaFiscalServico = (m) => ehServicoDeVenda(m) && (Number(m.pis || 0) + Number(m.cofins || 0) <= 0);

/** Carrega os movimentos já com o regime resolvido pelo cadastro de parceiros */
function carregar(empresaId, sentido, movimentoIds = null) {
  const tipo = sentido === 'saida' ? 'cliente' : 'fornecedor';
  let sql = `SELECT m.*, p.regime AS regime_cadastro, p.perfil_economico AS perfil_cadastro, p.descricao AS nome_cadastro,
      p.cnpj AS cnpj_cadastro, p.uf AS uf_parceiro
    FROM movimentos m
    LEFT JOIN parceiros p ON p.empresa_id = m.empresa_id AND p.tipo = m.tipo AND p.cnpj = m.inscr_federal
    WHERE m.empresa_id = ? AND m.tipo = ?`;
  const p = [empresaId, tipo];
  if (Array.isArray(movimentoIds)) {
    if (!movimentoIds.length) return [];
    sql += ` AND m.id IN (${movimentoIds.map(() => '?').join(',')})`;
    p.push(...movimentoIds);
  }
  return db.prepare(sql).all(...p);
}

/**
 * @param {number} empresaId
 * @param {object} opcoes { ano, anexoSimples, gravar }
 */
function executar(empresaId, opcoes = {}) {
  const empresaPersistida = db.prepare('SELECT * FROM empresas WHERE id = ?').get(empresaId);
  if (!empresaPersistida) throw new Error('Empresa não encontrada.');
  // Cenários podem alterar somente o contexto do regime durante uma execução
  // não persistida. O cadastro da empresa e os resultados oficiais ficam
  // intactos; a mesma implementação do motor continua sendo utilizada.
  const empresa = opcoes.regimeEmpresa ? { ...empresaPersistida, regime: opcoes.regimeEmpresa } : empresaPersistida;
  const ano = Number(opcoes.ano) || 2027;
  const tabelas = motor.anexosSimples();
  const referenciasVenda = new Map(db.prepare('SELECT * FROM empresa_servicos_fiscais WHERE empresa_id=? AND ativo=1').all(empresaId)
    .map((r) => [r.chave, r]));
  let movimentoIds = Array.isArray(opcoes.movimentoIds) ? opcoes.movimentoIds.map(Number).filter(Boolean) : null;
  const saidasOriginais = carregar(empresaId, 'saida', movimentoIds);
  // A referência da empresa continua disponível como terceira precedência,
  // mas serviços sem valor no XML não são mais bloqueados: o catálogo fiscal
  // pode trazer cumulatividade obrigatória, alíquota zero ou indeterminação
  // auditável para a operação.

  const entradas = [], saidas = [], conformidade = [];
  const cenariosPorFornecedor = new Map();

  // ------------------------------------------------------------------ ENTRADAS
  for (const m of carregar(empresaId, 'entrada', movimentoIds)) {
    const regime = m.regime_cadastro || m.regime || null;
    const item = normalizar(m);

    // Faixa do Simples do fornecedor: conhecida ou simulada (itens 12 e 39)
    let simplesEmitente = null;
    let cenarios = null;
    if (['simples_nacional', 'mei'].includes(regime)) {
      const anexo = opcoes.anexoSimples || (item.ncm ? 'I' : 'III');
      const fat = num(m.faturamento_parceiro);
      if (fat > 0) {
        simplesEmitente = simplesEfetivo(anexo, fat, tabelas);
        simplesEmitente.origem = 'faturamento conhecido';
      }
    }

    const proj = motor.projetarItem(item, {
      empresa, sentido: 'entrada', ano, regimeContraparte: regime, simplesEmitente,
    });

    if (['simples_nacional', 'mei'].includes(regime) && !simplesEmitente) {
      cenarios = motor.cenariosSimples(item, {
        empresa, sentido: 'entrada', ano, regimeContraparte: regime,
        anexo: opcoes.anexoSimples || (item.ncm ? 'I' : 'III'),
      });
      proj.cenariosSimples = cenarios;
      proj.natureza = 'SIMULADO';
      const chave = m.inscr_federal || m.nome;
      if (!cenariosPorFornecedor.has(chave)) cenariosPorFornecedor.set(chave, cenarios);
    }

    proj.conferencia = conferirDeclarado(proj, { ...m, declarado: item.declarado }, ano);
    entradas.push({ ...proj, movimento_id: m.id, regimeParceiro: regime });
    coletarConformidade(conformidade, proj, m, 'entrada', regime);
  }

  // -------------------------------------------------------------------- SAÍDAS
  const empresaSimples = ['simples_nacional', 'mei'].includes(empresa.regime)
    ? simplesEfetivo(opcoes.anexoSimples || 'I', num(empresa.faturamento_anual), tabelas)
    : null;
  if (empresaSimples) empresaSimples.origem = num(empresa.faturamento_anual) > 0 ? 'faturamento conhecido' : 'faixa simulada';

  for (const m of saidasOriginais) {
    const regime = m.regime_cadastro || m.regime || null;
    const item = normalizar({ ...m, referenciaFiscal: encontrarReferenciaServico(m, referenciasVenda) });
    const dest = m.perfil_cadastro === 'governo'
      ? { perfil: 'governo', detalhe: 'Ente governamental confirmado por cadastro oficial', credita: false }
      : motor.classificarDestinatario({ regime, cnpj: m.inscr_federal });

    const proj = motor.projetarItem(item, {
      empresa, sentido: 'saida', ano, regimeContraparte: regime,
      perfilDestinatario: dest.perfil, simplesEmitente: empresaSimples,
    });
    proj.destinatario = dest;
    proj.sensibilidade = motor.sensibilidadeCredito({
      perfil: dest.perfil, credita: dest.credita, credito: proj.credito, projecao: proj,
    });

    // Empresa no Simples: comparar tradicional x híbrido (itens 14 e 16)
    if (empresaSimples) {
      const hib = motor.projetarItem(item, {
        empresa, sentido: 'saida', ano, regimeContraparte: regime,
        perfilDestinatario: dest.perfil, hibrido: true,
      });
      proj.comparativoRegime = {
        tradicional: { ibs: proj.ibs, cbs: proj.cbs, precoProjetado: proj.precoProjetado, creditoAoCliente: proj.creditoTotal },
        hibrido: { ibs: hib.ibs, cbs: hib.cbs, precoProjetado: hib.precoProjetado, creditoAoCliente: hib.creditoTotal },
        natureza: 'SIMULADO',
        leitura: hib.creditoTotal > proj.creditoTotal
          ? 'No regime regular a empresa entregaria mais crédito ao cliente, o que a torna mais competitiva em vendas B2B — ao custo de apurar IBS/CBS por fora.'
          : 'A permanência no DAS não reduz de forma relevante o crédito entregue nesta operação.',
      };
    }

    proj.conferencia = conferirDeclarado(proj, { ...m, declarado: item.declarado }, ano);
    saidas.push({ ...proj, movimento_id: m.id, regimeParceiro: regime });
    coletarConformidade(conformidade, proj, m, 'saida', regime);
  }

  // ---------------------------------------------------------------- APURAÇÃO
  const apuracao = motor.apurar(saidas, entradas);
  const atualSaidas = motor.cargaAtual(saidas);
  const atualEntradas = motor.cargaAtual(entradas);

  const resumo = {
    ano,
    itens: entradas.length + saidas.length,
    entradas: entradas.length, saidas: saidas.length,
    classificados: [...entradas, ...saidas].filter((x) => x.classificacao.status === 'CLASSIFICADO').length,
    requerValidacao: [...entradas, ...saidas].filter((x) => x.classificacao.status === 'REQUER_VALIDACAO').length,
    semCorrespondencia: [...entradas, ...saidas].filter((x) => x.classificacao.status === 'SEM_CORRESPONDENCIA').length,
    comprasAnalisadas: r2(entradas.reduce((s, x) => s + x.precoAtual, 0)),
    faturamentoAnalisado: r2(saidas.reduce((s, x) => s + x.precoAtual, 0)),
    baseEconomicaEntradas: r2(entradas.reduce((s, x) => s + x.baseEconomica, 0)),
    baseEconomicaSaidas: r2(saidas.reduce((s, x) => s + x.baseEconomica, 0)),
    apuracao,
    cargaAtual: {
      saidas: atualSaidas, entradas: atualEntradas,
      totalSaidas: atualSaidas.total,
    },
    comparacao: compararCargas(atualSaidas, apuracao, saidas),
    conformidade: agruparConformidade(conformidade),
    simulados: [...entradas, ...saidas].filter((x) => x.natureza === 'SIMULADO').length,
    conferencia: (() => {
      const t = [...entradas, ...saidas].filter((x) => x.conferencia);
      const ok = t.filter((x) => x.conferencia.confere).length;
      return { comparaveis: t.length, conferem: ok, divergem: t.length - ok,
        diferencaTotal: r2(t.filter((x) => !x.conferencia.confere)
          .reduce((s2, x) => s2 + Math.abs(x.conferencia.difTotal), 0)) };
    })(),
  };

  if (opcoes.gravar !== false) gravar(empresaId, ano, resumo, entradas, saidas, { incremental: Boolean(movimentoIds) });
  return { empresa, ano, resumo, entradas, saidas, apuracao,
    cenariosSimples: [...cenariosPorFornecedor.entries()].map(([k, v]) => ({ fornecedor: k, ...v })) };
}

/** Converte a linha do banco no formato que o motor espera */
function normalizar(m) {
  return {
    documento: m.documento || '', item_numero: m.item_numero,
    nome: m.nome_cadastro || m.nome, inscr_federal: m.inscr_federal,
    descricao: m.descricao, ncm: m.ncm, nbs: m.nbs, cfop: m.cfop,
    cst: m.cst, csosn: m.csosn, quantidade: m.quantidade,
    valor: m.valor, base_calculo: m.base_calculo,
    icms: m.icms, icms_st: m.icms_st, ipi: m.ipi,
    pis: m.pis, cofins: m.cofins, pis_cofins_documentado: Number(m.pis_cofins_documentado) === 1, iss: m.iss,
    pis_cofins_referencia: m.referenciaFiscal?.pis_cofins,
    frete: m.frete, seguro: m.seguro, outras: m.outras, desconto: m.desconto,
    data_emissao: m.data_emissao,
    declarado: (m.cst_declarado || m.cclasstrib_declarado || m.ibs_declarado || m.cbs_declarado) ? {
      cst: m.cst_declarado, cclasstrib: m.cclasstrib_declarado,
      ibs: m.ibs_declarado, cbs: m.cbs_declarado,
    } : null,
  };
}

/** Comparação atual x reforma (item 33) — só com o que veio dos documentos */
function compararCargas(atual, apuracao, saidas) {
  const base = saidas.reduce((s, x) => s + x.baseEconomica, 0);
  const projetada = apuracao.ibs.debitos + apuracao.cbs.debitos;
  const diferenca = projetada - atual.total;
  return {
    cargaAtual: atual.total,
    cargaProjetada: r2(projetada),
    diferenca: r2(diferenca),
    diferencaPerc: atual.total ? Math.round((diferenca / atual.total) * 10000) / 10000 : null,
    percentualSobreBase: base ? Math.round((projetada / base) * 10000) / 10000 : 0,
    observacao: 'Comparação restrita aos tributos efetivamente identificados nos documentos importados.',
  };
}

/**
 * Confere o IBS/CBS que o próprio documento declara contra o que o motor
 * projeta para o MESMO ano. Só faz sentido quando o ano da execução coincide
 * com o ano de emissão — comparar 2033 com um documento de 2026 não diz nada.
 *
 * Divergência aqui não significa erro do motor nem do emissor: significa que
 * há dois critérios de base em circulação, e isso precisa ser resolvido antes
 * de a empresa confiar em qualquer projeção. Foi assim que se descobriu, num
 * conjunto real, que dois emissores da mesma empresa calculavam a base de
 * formas diferentes.
 */
function conferirDeclarado(proj, m, ano) {
  const d = proj.declarado || (m.declarado || null);
  if (!d || (!d.ibs && !d.cbs)) return null;
  const anoDoc = Number(String(m.data_emissao || '').slice(0, 4));
  if (!anoDoc || anoDoc !== Number(ano)) return null;
  const difIbs = proj.ibs - num(d.ibs);
  const difCbs = proj.cbs - num(d.cbs);
  const tolerancia = regras.limiar('tolerancia_conferencia', 0.02);
  if (Math.abs(difIbs) < tolerancia && Math.abs(difCbs) < tolerancia) {
    return { confere: true, declaradoIbs: num(d.ibs), declaradoCbs: num(d.cbs) };
  }
  return {
    confere: false,
    declaradoIbs: num(d.ibs), declaradoCbs: num(d.cbs),
    projetadoIbs: proj.ibs, projetadoCbs: proj.cbs,
    difIbs: r2(difIbs), difCbs: r2(difCbs),
    difTotal: r2(difIbs + difCbs),
    baseDeclarada: num(d.baseIbsCbs) || null,
    baseProjetada: proj.baseEconomica,
  };
}

/** Conformidade (item 37) — apenas as regras listadas, sem ampliar */
function coletarConformidade(lista, proj, m, sentido, regime) {
  const add = (tipo, descricao, gravidade = 'media') => lista.push({
    tipo, descricao, gravidade, sentido,
    documento: proj.documento, item: proj.descricao,
    parceiro: proj.contraparte, cnpj: proj.cnpj,
    ncm: proj.ncm, nbs: proj.nbs, valor: proj.precoAtual, movimento_id: m.id,
  });

  const c = proj.classificacao;
  if (c.status === 'SEM_CORRESPONDENCIA') {
    add(proj.ncm ? 'ncm_sem_correspondencia' : 'nbs_sem_correspondencia',
      proj.ncm ? `NCM ${proj.ncm} sem correspondência nas bases` : 'Item sem NCM/NBS para classificar', 'alta');
  }
  if (c.status === 'REQUER_VALIDACAO') {
    if (c.candidatos && c.candidatos.length > 1) add('multiplas_classificacoes', `${c.candidatos.length} enquadramentos possíveis`, 'alta');
    else add('cclasstrib_indefinido', c.fundamentos[c.fundamentos.length - 1] || 'Classificação pendente de validação', 'media');
  }
  if (!c.cst && c.status !== 'SEM_CORRESPONDENCIA') add('cst_indefinido', 'CST IBS/CBS não determinado', 'media');
  if (!regime) add(sentido === 'entrada' ? 'regime_fornecedor_desconhecido' : 'regime_cliente_desconhecido',
    'Regime da contraparte não cadastrado — afeta diretamente a projeção de crédito', 'alta');
  if (['simples_nacional', 'mei'].includes(regime) && (!proj.simples || proj.simples.origem !== 'faturamento conhecido')) {
    add('faturamento_simples_desconhecido', 'Faturamento do fornecedor do Simples desconhecido — crédito estimado por faixa', 'media');
  }
  if (proj.reconstrucao.status !== 'reconstruida') {
    add('base_economica_insegura',
      proj.reconstrucao.status === 'estimada'
        ? 'Base econômica reconstruída com valores estimados'
        : 'Base econômica não reconstruída com segurança', proj.reconstrucao.status === 'estimada' ? 'media' : 'alta');
  }
  if (['SUJEITO_VALIDACAO', 'DADOS_INSUFICIENTES'].includes(proj.credito.status)) {
    add('credito_dependente_validacao', proj.credito.motivo, 'media');
  }
  if (proj.conferencia && proj.conferencia.confere === false) {
    const c = proj.conferencia;
    add('divergencia_ibscbs_declarado',
      `Documento declara IBS ${c.declaradoIbs} e CBS ${c.declaradoCbs}; o motor projeta ${c.projetadoIbs} e ${c.projetadoCbs} para o mesmo ano (diferença de ${c.difTotal}). Base declarada ${c.baseDeclarada || '—'} contra base reconstruída ${c.baseProjetada}.`,
      'alta');
  }
  if (proj.classificacao.divergencia) {
    add('divergencia_classificacao_declarada',
      'O cClassTrib declarado pelo emissor difere do que a base indica para este serviço.', 'alta');
  }
}

function agruparConformidade(lista) {
  const mapa = new Map();
  for (const c of lista) {
    if (!mapa.has(c.tipo)) mapa.set(c.tipo, { tipo: c.tipo, gravidade: c.gravidade, itens: 0, valor: 0, exemplos: [] });
    const g = mapa.get(c.tipo);
    g.itens++; g.valor += num(c.valor);
    if (g.exemplos.length < 8) g.exemplos.push(c);
  }
  return [...mapa.values()].map((g) => ({ ...g, valor: r2(g.valor), rotulo: ROTULOS[g.tipo] || g.tipo }))
    .sort((a, b) => b.valor - a.valor);
}

const ROTULOS = {
  ncm_sem_correspondencia: 'NCM sem correspondência nas bases',
  nbs_sem_correspondencia: 'NBS sem correspondência nas bases',
  cst_indefinido: 'CST IBS/CBS indefinido',
  cclasstrib_indefinido: 'cClassTrib indefinido',
  multiplas_classificacoes: 'Múltiplas classificações possíveis',
  regime_fornecedor_desconhecido: 'Regime do fornecedor desconhecido',
  regime_cliente_desconhecido: 'Regime do cliente desconhecido',
  faturamento_simples_desconhecido: 'Faturamento do fornecedor do Simples desconhecido',
  base_economica_insegura: 'Base econômica não reconstruída com segurança',
  credito_dependente_validacao: 'Crédito dependente de validação',
  divergencia_ibscbs_declarado: 'IBS/CBS declarado no documento diverge do projetado',
  divergencia_classificacao_declarada: 'cClassTrib declarado diverge da base',
};

function gravar(empresaId, ano, resumo, entradas, saidas, opcoes = {}) {
  const ex = db.prepare(`INSERT INTO motor_execucoes (empresa_id, ano, itens, classificados,
    requer_validacao, sem_correspondencia, resumo) VALUES (?,?,?,?,?,?,?)`)
    .run(empresaId, ano, resumo.itens, resumo.classificados, resumo.requerValidacao,
      resumo.semCorrespondencia, JSON.stringify(resumo));
  const id = ex.lastInsertRowid;
  const linhas = [...entradas, ...saidas];
  if (opcoes.incremental) {
    const ids = linhas.map((x) => x.movimento_id).filter(Boolean);
    if (ids.length) db.prepare(`DELETE FROM motor_resultados WHERE empresa_id=? AND movimento_id IN (${ids.map(() => '?').join(',')})`).run(empresaId, ...ids);
  } else db.prepare('DELETE FROM motor_resultados WHERE empresa_id = ?').run(empresaId);
  const ins = db.prepare(`INSERT INTO motor_resultados (empresa_id, movimento_id, execucao_id, sentido, ano,
    status_classificacao, status_credito, natureza, preco_atual, base_economica, ibs, cbs,
    credito_ibs, credito_cbs, tipo_credito, modalidade_credito, status_credito_determinacao, movimento_hash, regra_version, catalogo_version, parceiro_version, parametro_version, motor_version, regime_cbs_emitente, regime_cbs_adquirente, preco_projetado, custo_liquido, cst, cclasstrib, tratamento,
    perfil_destinatario, sensibilidade, estado_autonomia, codigo_causa, origem_resolucao, evidencia_utilizada, regra_vencedora, requer_intervencao_humana, motivo_intervencao, autonomia_calculo_cbs_propria, autonomia_credito_entrada, autonomia_credito_cliente, autonomia_classificatoria, autonomia_diagnostico_completo, memoria_autonomia_dimensoes, detalhe)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const x of linhas) {
      const movimento = db.prepare('SELECT * FROM movimentos WHERE id=?').get(x.movimento_id) || {};
      const parceiro = db.prepare('SELECT * FROM parceiros WHERE empresa_id=? AND cnpj=? AND tipo=?').get(empresaId, movimento.inscr_federal || '', movimento.tipo || '');
      const versoes = versoesDaOperacao(movimento, parceiro);
      const telemetria = autonomiaTelemetry.avaliar({
        ...x, detalhe: x, status_classificacao: x.classificacao?.status,
        status_credito_determinacao: x.credito?.statusDeterminacao,
        status_credito: x.credito?.status, regra_version: versoes.regra_version,
      });
      const dimensoes = avaliarDimensoes({ ...x, sentido: x.sentido, base_economica: x.baseEconomica,
        status_credito_determinacao: x.credito?.statusDeterminacao, status_credito: x.credito?.status,
        cclasstrib: x.classificacao?.cclasstrib });
      ins.run(empresaId, x.movimento_id, id, x.sentido, ano,
        x.classificacao.status, x.credito.status, x.natureza,
        x.precoAtual, x.baseEconomica, x.ibs, x.cbs, x.creditoIbs, x.creditoCbs, x.credito.tipoCredito || null, x.credito.modalidadeCredito || null, x.credito.statusDeterminacao || null,
        hashMovimento(movimento), versoes.regra_version, versoes.catalogo_version, hashParceiro(parceiro), versoes.parametro_version, versoes.motor_version, x.regimeCbsEmitente || null, x.regimeCbsAdquirente || null,
        x.precoProjetado, x.custoLiquido, x.classificacao.cst, x.classificacao.cclasstrib,
        x.classificacao.tratamento, x.destinatario ? x.destinatario.perfil : null,
        x.sensibilidade ? x.sensibilidade.nivel : null,
        telemetria.estado_autonomia, telemetria.codigo_causa, telemetria.origem_resolucao,
        telemetria.evidencia_utilizada, telemetria.regra_vencedora, telemetria.requer_intervencao_humana,
        telemetria.motivo_intervencao, dimensoes.autonomia_calculo_cbs_propria == null ? null : Number(dimensoes.autonomia_calculo_cbs_propria),
        dimensoes.autonomia_credito_entrada == null ? null : Number(dimensoes.autonomia_credito_entrada),
        dimensoes.autonomia_credito_cliente == null ? null : Number(dimensoes.autonomia_credito_cliente),
        dimensoes.autonomia_classificatoria, dimensoes.autonomia_diagnostico_completo == null ? null : Number(dimensoes.autonomia_diagnostico_completo), JSON.stringify(dimensoes.memoria), JSON.stringify(x));
    }
  })();
  const linhasTelemetria = db.prepare('SELECT * FROM motor_resultados WHERE empresa_id=? AND execucao_id=?').all(empresaId, id);
  const consolidadoAutonomia = autonomiaTelemetry.consolidar(linhasTelemetria);
  db.prepare(`INSERT INTO telemetria_autonomia_execucoes
    (execucao_id,empresa_id,meta_autonomia,total_operacoes,operacoes_autonomas,operacoes_intervencao,taxa_autonomia,taxa_determinacao,taxa_simulacao,taxa_indeterminacao_automatica,taxa_intervencao_humana,estados_json,atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(execucao_id) DO UPDATE SET total_operacoes=excluded.total_operacoes,operacoes_autonomas=excluded.operacoes_autonomas,operacoes_intervencao=excluded.operacoes_intervencao,taxa_autonomia=excluded.taxa_autonomia,taxa_determinacao=excluded.taxa_determinacao,taxa_simulacao=excluded.taxa_simulacao,taxa_indeterminacao_automatica=excluded.taxa_indeterminacao_automatica,taxa_intervencao_humana=excluded.taxa_intervencao_humana,estados_json=excluded.estados_json,atualizado_em=excluded.atualizado_em`)
    .run(id, empresaId, consolidadoAutonomia.meta_autonomia, consolidadoAutonomia.total_operacoes, consolidadoAutonomia.operacoes_autonomas, consolidadoAutonomia.operacoes_intervencao, consolidadoAutonomia.taxa_autonomia, consolidadoAutonomia.taxa_determinacao, consolidadoAutonomia.taxa_simulacao, consolidadoAutonomia.taxa_indeterminacao_automatica, consolidadoAutonomia.taxa_intervencao_humana, JSON.stringify(consolidadoAutonomia.estados), new Date().toISOString());
  // A fila não reprocessa nem escolhe uma classificação: só materializa o
  // dado/evidência que uma futura execução incremental deve aguardar.
  pendenciasEnriquecimento.sincronizar(db, empresaId, id);
  // A classificação e a reconstrução já foram tentadas pelo motor. Só agora
  // persistimos o que realmente ficou pendente, priorizado por materialidade.
  // Isso permite operar por exceção, sem revisão manual de toda a carteira.
  excecoesMotor.sincronizar(empresaId, id);
  // A publicação é assíncrona para não prender a importação. Falhas não
  // descartam a fotografia local; a próxima execução pode publicar de novo.
  try {
    const operacao = require('./operacaoCompartilhada');
    if (operacao.ativo()) operacao.publicarResultadosMotor(empresaId)
      .catch((e) => console.error('[supabase] resultados do motor:', e.message));
  } catch (_) { /* ambiente sem operação compartilhada */ }
  return id;
}

// ==========================================================================
// CONSOLIDAÇÕES PARA AS TELAS EXISTENTES
// ==========================================================================
/** Item 34 — resultado por fornecedor */
function porFornecedor(resultado) {
  return agrupar(resultado.entradas, (x) => x.cnpj || x.contraparte, (g, x) => {
    g.comprasAtuais += x.precoAtual;
    g.baseEconomica += x.baseEconomica;
    g.ibs += x.ibs; g.cbs += x.cbs;
    g.creditoIbs += x.creditoIbs; g.creditoCbs += x.creditoCbs;
    g.custoLiquido += x.custoLiquido;
    if (x.cenariosSimples) g.cenariosSimples = x.cenariosSimples;
    if (['SUJEITO_VALIDACAO', 'DADOS_INSUFICIENTES'].includes(x.credito.status)) g.pendencias++;
    if (x.classificacao.status !== 'CLASSIFICADO') g.pendencias++;
  }, (x) => ({ fornecedor: x.contraparte, cnpj: x.cnpj, regime: x.regimeEmitente }));
}

/** Item 35 — resultado por cliente */
function porCliente(resultado) {
  return agrupar(resultado.saidas, (x) => x.cnpj || x.contraparte, (g, x) => {
    g.faturamento += x.precoAtual;
    g.baseEconomica += x.baseEconomica;
    g.ibs += x.ibs; g.cbs += x.cbs;
    g.creditoEntregue += x.creditoTotal;
    g.custoLiquidoCliente += x.custoLiquido;
    g.perfil = x.destinatario ? x.destinatario.perfil : g.perfil;
    if (x.sensibilidade) g.sensibilidades.push(x.sensibilidade.nivel);
    if (x.classificacao.status !== 'CLASSIFICADO') g.pendencias++;
  }, (x) => ({ cliente: x.contraparte, cnpj: x.cnpj, regime: x.regimeAdquirente,
    perfil: x.destinatario ? x.destinatario.perfil : null, sensibilidades: [] }));
}

function agrupar(lista, chaveFn, acumular, inicial) {
  const mapa = new Map();
  for (const x of lista) {
    const k = chaveFn(x);
    if (!mapa.has(k)) mapa.set(k, {
      ...inicial(x), itens: 0, pendencias: 0,
      comprasAtuais: 0, faturamento: 0, baseEconomica: 0, ibs: 0, cbs: 0,
      creditoIbs: 0, creditoCbs: 0, creditoEntregue: 0, custoLiquido: 0, custoLiquidoCliente: 0,
    });
    const g = mapa.get(k);
    g.itens++;
    acumular(g, x);
  }
  return [...mapa.values()].map((g) => {
    const o = { ...g };
    ['comprasAtuais', 'faturamento', 'baseEconomica', 'ibs', 'cbs', 'creditoIbs', 'creditoCbs',
      'creditoEntregue', 'custoLiquido', 'custoLiquidoCliente'].forEach((k) => { o[k] = r2(o[k]); });
    o.creditoTotal = r2(o.creditoIbs + o.creditoCbs);
    if (o.sensibilidades && o.sensibilidades.length) {
      const ordem = ['ALTA', 'MEDIA', 'BAIXA', 'NAO_APLICAVEL', 'REQUER_VALIDACAO'];
      o.sensibilidade = o.sensibilidades.sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))[0];
      delete o.sensibilidades;
    }
    return o;
  }).sort((a, b) => (b.comprasAtuais || b.faturamento) - (a.comprasAtuais || a.faturamento));
}

function ultimaExecucao(empresaId) {
  const ex = db.prepare('SELECT * FROM motor_execucoes WHERE empresa_id = ? ORDER BY id DESC LIMIT 1').get(empresaId);
  if (!ex) return null;
  return { ...ex, resumo: JSON.parse(ex.resumo || '{}') };
}

function resultados(empresaId, filtros = {}) {
  let sql = 'SELECT * FROM motor_resultados WHERE empresa_id = ?';
  const p = [empresaId];
  if (filtros.sentido) { sql += ' AND sentido = ?'; p.push(filtros.sentido); }
  if (filtros.status) { sql += ' AND status_classificacao = ?'; p.push(filtros.status); }
  sql += ' ORDER BY preco_atual DESC LIMIT ?';
  p.push(Math.min(Number(filtros.limite) || 500, 5000));
  return db.prepare(sql).all(...p).map((r) => ({ ...r, detalhe: JSON.parse(r.detalhe || '{}') }));
}

function resultadoMaterializado(empresa, ano) {
  const linhas = db.prepare('SELECT * FROM motor_resultados WHERE empresa_id=?').all(empresa.id)
    .map((r) => { try { return JSON.parse(r.detalhe || '{}'); } catch (_) { return null; } }).filter(Boolean);
  const entradas = linhas.filter((x) => x.sentido === 'entrada');
  const saidas = linhas.filter((x) => x.sentido === 'saida');
  const apuracao = motor.apurar(saidas, entradas);
  return { empresa, ano, entradas, saidas, apuracao, resumo: {
    ano, itens: linhas.length, entradas: entradas.length, saidas: saidas.length,
    apuracao, materializado: true, observacao: 'Resultados vigentes reutilizados sem novo cálculo.' }, cenariosSimples: [] };
}

/** Identifica apenas operações cuja entrada ou dependência mudou. */
function pendentesIncrementais(empresaId, opcoes = {}) {
  const todos = db.prepare(`SELECT m.*, p.regime AS regime_cadastro, p.perfil_economico AS perfil_cadastro,
    p.descricao AS nome_cadastro, p.cnpj AS cnpj_cadastro, p.uf AS uf_parceiro
    FROM movimentos m LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo AND p.cnpj=m.inscr_federal
    WHERE m.empresa_id=?`).all(empresaId);
  const atuais = new Map(db.prepare(`SELECT movimento_id,movimento_hash,regra_version,catalogo_version,parceiro_version,parametro_version,motor_version
    FROM motor_resultados WHERE empresa_id=?`).all(empresaId).map((x) => [x.movimento_id, x]));
  return todos.filter((m) => {
    const anterior = atuais.get(m.id);
    const versoes = versoesDaOperacao(m, m);
    if (!anterior) return true;
    if (opcoes.forcar) return true;
    return anterior.movimento_hash !== hashMovimento(m)
      || anterior.regra_version !== versoes.regra_version
      || anterior.catalogo_version !== versoes.catalogo_version
      || anterior.parceiro_version !== versoes.parceiro_version
      || anterior.parametro_version !== versoes.parametro_version
      || anterior.motor_version !== versoes.motor_version;
  }).map((m) => m.id);
}

/**
 * Reprocessa só o subconjunto invalidado. A apuração agregada continuará
 * lendo todas as linhas vigentes de motor_resultados, inclusive as intactas.
 */
function reprocessarIncremental(empresaId, opcoes = {}) {
  // Movimentos removidos não podem permanecer na fotografia materializada.
  // Isso é uma invalidação incremental também: remove somente órfãos desta
  // empresa e preserva todos os resultados ainda vigentes.
  const removidos = db.prepare(`DELETE FROM motor_resultados
    WHERE empresa_id=? AND movimento_id NOT IN (SELECT id FROM movimentos WHERE empresa_id=?)`)
    .run(empresaId, empresaId).changes;
  const movimentoIds = opcoes.movimentoIds || pendentesIncrementais(empresaId, opcoes);
  if (!movimentoIds.length) return { empresa_id: empresaId, reprocessados: 0, removidos, status: removidos ? 'CONCLUIDO' : 'SEM_ALTERACOES' };
  const resultado = executar(empresaId, { ...opcoes, movimentoIds, ano: Number(opcoes.ano) || 2027 });
  return { empresa_id: empresaId, reprocessados: movimentoIds.length, removidos, status: 'CONCLUIDO', resultado };
}

module.exports = { executar, reprocessarIncremental, pendentesIncrementais, porFornecedor, porCliente, ultimaExecucao, resultados, normalizar, hashMovimento, versoesAtuais, versoesDaOperacao };

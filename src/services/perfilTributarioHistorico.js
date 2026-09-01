/*
 * Perfil Tributário e Raio-X Histórico.
 *
 * Camada exclusivamente de leitura: consolida fatos já persistidos e a
 * fotografia CBS produzida pelo motor. Não executa o motor nem preenche
 * lacunas com estimativas.
 */
const numero = (v) => Number(v) || 0;
const tem = (v) => v !== null && v !== undefined;

function valor(valor, natureza = 'REAL') {
  return tem(valor) ? { valor: numero(valor), natureza } : { valor: null, natureza: 'INDETERMINADO' };
}

function tabelaExiste(db, nome) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(nome));
}

function consolidar(db, empresaId) {
  const empresa = db.prepare('SELECT id, razao_social, regime FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');

  const perfis = db.prepare('SELECT * FROM perfil_tributario WHERE empresa_id=? AND COALESCE(competencia,\'\')<>\'\' ORDER BY competencia').all(empresaId);
  const folhas = db.prepare('SELECT * FROM folhas_pagamento_competencias WHERE empresa_id=?').all(empresaId);
  const margens = db.prepare('SELECT * FROM margens_operacionais_premissas WHERE empresa_id=?').all(empresaId);
  const receitasSemDfe = db.prepare('SELECT * FROM receitas_sem_dfe WHERE empresa_id=?').all(empresaId);
  const cbs = db.prepare('SELECT * FROM perfil_cbs_competencias WHERE empresa_id=?').all(empresaId);
  const documentos = db.prepare(`SELECT competencia, SUM(COALESCE(valor,0)) receita_documentada,
      COUNT(*) quantidade_documentos, SUM(COALESCE(iss,0)) iss_documentado
    FROM movimentos WHERE empresa_id=? AND (tipo='cliente' OR sentido='saida')
      AND COALESCE(competencia,'')<>'' GROUP BY competencia`).all(empresaId);
  const apuracoes = tabelaExiste(db, 'pis_cofins_apuracoes_historicas')
    ? db.prepare(`SELECT a.*, d.nome_original, d.hash_sha256 FROM pis_cofins_apuracoes_historicas a
      JOIN pis_cofins_apuracao_documentos d ON d.id=a.documento_id
      WHERE a.empresa_id=? AND COALESCE(a.competencia,'')<>'' ORDER BY a.id DESC`).all(empresaId)
    : [];

  const porCompetencia = new Map();
  const obter = (competencia) => {
    if (!porCompetencia.has(competencia)) porCompetencia.set(competencia, { competencia });
    return porCompetencia.get(competencia);
  };
  perfis.forEach((x) => { obter(x.competencia).perfil = x; });
  folhas.forEach((x) => { obter(x.competencia).folha = x; });
  documentos.forEach((x) => { obter(x.competencia).documentos = x; });
  cbs.forEach((x) => { obter(x.competencia).cbs = x; });
  apuracoes.forEach((x) => { if (!obter(x.competencia).apuracao_pis_cofins) obter(x.competencia).apuracao_pis_cofins = x; });
  receitasSemDfe.forEach((x) => {
    const p = obter(x.competencia); (p.receitas_sem_dfe ||= []).push(x);
  });

  const historico = [...porCompetencia.values()].sort((a, b) => String(a.competencia).localeCompare(String(b.competencia))).map((linha) => {
    const p = linha.perfil;
    const receitaPerfil = p ? numero(p.receita_bruta) : null;
    const receitaDocumentada = linha.documentos ? numero(linha.documentos.receita_documentada) : null;
    const receitaSemDfe = (linha.receitas_sem_dfe || []).reduce((s, x) => s + numero(x.valor), 0);
    const tributosHistoricos = p ? numero(p.icms) + numero(p.iss) + numero(p.ipi) + numero(p.pis) + numero(p.cofins) + numero(p.das) : null;
    const receitaParaCarga = receitaPerfil !== null ? receitaPerfil : receitaDocumentada;
    const margem = margens.find((x) => x.periodo_inicio <= linha.competencia && x.periodo_fim >= linha.competencia) || null;
    const eSimples = /simples|mei/.test(String(empresa.regime || '').toLowerCase());
    const eLucroReal = /lucro_real|lucro real/.test(String(empresa.regime || '').toLowerCase());
    const cbsAtual = linha.cbs || null;
    const especiais = cbsAtual ? numero(cbsAtual.receita_reducao_cbs) + numero(cbsAtual.receita_aliquota_zero_cbs)
      + numero(cbsAtual.receita_imunidade_cbs) + numero(cbsAtual.receita_regime_especifico_cbs)
      + numero(cbsAtual.receita_beneficio_governo_cbs) : null;
    const apuracao = linha.apuracao_pis_cofins || null;
    const apuracaoConfirmada = apuracao?.status_validacao === 'VALIDADO_USUARIO'
      && apuracao.pis_recolhido !== null && apuracao.pis_recolhido !== undefined
      && apuracao.cofins_recolhida !== null && apuracao.cofins_recolhida !== undefined;
    const cargaPisCofinsAtual = apuracaoConfirmada
      ? { valor: numero(apuracao.pis_recolhido) + numero(apuracao.cofins_recolhida), natureza: 'REAL', origem: 'APURACAO_CONFIRMADA' }
      : p ? { valor: numero(p.pis) + numero(p.cofins), natureza: 'REAL', origem: 'PERFIL_HISTORICO' }
        : { valor: null, natureza: 'INDETERMINADO', origem: 'INDETERMINADO' };
    return {
      competencia: linha.competencia,
      regime: empresa.regime || 'INDETERMINADO',
      receita: valor(receitaPerfil !== null ? receitaPerfil : receitaDocumentada, receitaPerfil !== null ? 'REAL' : receitaDocumentada !== null ? 'EXTRAIDO' : 'INDETERMINADO'),
      receita_documentada: valor(receitaDocumentada, receitaDocumentada !== null ? 'EXTRAIDO' : 'INDETERMINADO'),
      folha: valor(linha.folha?.valor_folha, linha.folha ? 'REAL' : 'INDETERMINADO'),
      margem_operacional: valor(margem?.margem_operacional_percentual, margem ? 'PREMISSA_INFORMADA' : 'INDETERMINADO'),
      composicao_receitas: p ? {
        mercadorias: valor(p.receita_mercadorias), servicos: valor(p.receita_servicos), exportacao: valor(p.receita_exportacao),
      } : { natureza: 'INDETERMINADO' },
      receitas_sem_dfe: { valor: (linha.receitas_sem_dfe || []).length ? receitaSemDfe : null, natureza: (linha.receitas_sem_dfe || []).length ? 'REAL' : 'INDETERMINADO', registros: (linha.receitas_sem_dfe || []).length },
      pis_historico: valor(p?.pis, p ? 'REAL' : 'INDETERMINADO'),
      cofins_historico: valor(p?.cofins, p ? 'REAL' : 'INDETERMINADO'),
      carga_pis_cofins_atual: cargaPisCofinsAtual,
      carga_pis_cofins_percentual: receitaParaCarga ? { valor: cargaPisCofinsAtual.valor === null ? null : cargaPisCofinsAtual.valor / receitaParaCarga, natureza: cargaPisCofinsAtual.natureza, origem: cargaPisCofinsAtual.origem } : { valor: null, natureza: 'INDETERMINADO', origem: 'INDETERMINADO' },
      apuracao_pis_cofins_historica: apuracao ? {
        pis_debito: valor(apuracao.pis_debito, 'EXTRAIDO'), cofins_debito: valor(apuracao.cofins_debito, 'EXTRAIDO'),
        pis_credito: valor(apuracao.pis_credito, 'EXTRAIDO'), cofins_credito: valor(apuracao.cofins_credito, 'EXTRAIDO'),
        pis_recolhido: valor(apuracao.pis_recolhido, 'EXTRAIDO'), cofins_recolhida: valor(apuracao.cofins_recolhida, 'EXTRAIDO'),
        status_validacao: apuracao.status_validacao, documento: apuracao.nome_original, hash_lineage: apuracao.hash_sha256,
      } : { natureza: 'INDETERMINADO' },
      pgdas: eSimples ? valor(p?.das, p ? 'REAL' : 'INDETERMINADO') : { valor: null, natureza: 'NAO_APLICAVEL' },
      creditos_lucro_real: eLucroReal ? valor(p?.creditos_tomados, p ? 'REAL' : 'INDETERMINADO') : { valor: null, natureza: 'NAO_APLICAVEL' },
      carga_efetiva_historica: receitaParaCarga !== null && receitaParaCarga !== 0 && tributosHistoricos !== null
        ? { valor: tributosHistoricos / receitaParaCarga, natureza: 'CALCULADO' } : { valor: null, natureza: 'INDETERMINADO' },
      tratamentos_identificados: especiais === null ? 'INDETERMINADO' : especiais > 0 ? 'TRATAMENTO_ESPECIAL_IDENTIFICADO' : 'NAO_IDENTIFICADO_NA_FOTOGRAFIA_CBS',
      cbs_motor_existente: cbsAtual ? { debito: numero(cbsAtual.cbs_debito), credito: numero(cbsAtual.cbs_credito), liquida: numero(cbsAtual.cbs_liquida), natureza: 'CALCULADO', motor_execucao_id: cbsAtual.motor_execucao_id } : { natureza: 'INDETERMINADO' },
      comparacao_anterior_x_cbs: {
        carga_efetiva_historica: receitaParaCarga !== null && receitaParaCarga !== 0 && cargaPisCofinsAtual.valor !== null ? cargaPisCofinsAtual.valor / receitaParaCarga : null,
        cbs_liquida_motor: cbsAtual ? numero(cbsAtual.cbs_liquida) : null,
        natureza: cbsAtual ? 'CALCULADO' : 'INDETERMINADO',
      },
    };
  });

  const cobertura = {
    regime_atual: empresa.regime ? 'DISPONIVEL' : 'INDETERMINADO',
    periodos_historicos: historico.length ? 'DISPONIVEL' : 'INDETERMINADO',
    receitas: historico.some((x) => x.receita.natureza !== 'INDETERMINADO') ? 'DISPONIVEL' : 'INDETERMINADO',
    folha: historico.some((x) => x.folha.natureza !== 'INDETERMINADO') ? 'DISPONIVEL' : 'INDETERMINADO',
    margem_operacional: historico.some((x) => x.margem_operacional.natureza !== 'INDETERMINADO') ? 'DISPONIVEL' : 'INDETERMINADO',
    cbs_motor: historico.some((x) => x.cbs_motor_existente.natureza === 'CALCULADO') ? 'DISPONIVEL' : 'INDETERMINADO',
  };
  return { empresa: { id: empresa.id, nome: empresa.razao_social, regime_atual: empresa.regime || 'INDETERMINADO' }, cobertura, historico };
}

module.exports = { consolidar };

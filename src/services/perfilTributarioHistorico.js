/*
 * Perfil Tributário e Raio-X Histórico.
 *
 * Camada exclusivamente de leitura: consolida fatos já persistidos e a
 * fotografia CBS produzida pelo motor. Não executa o motor nem preenche
 * lacunas com estimativas.
 */
const numero = (v) => Number(v) || 0;
const tem = (v) => v !== null && v !== undefined;
const receitaOperacional = require('./receitaOperacional');
const pgdasDocumentoIa = require('./pgdasDocumentoIa');

// O importador de XML já persiste `valor` como valor econômico documental:
// vProd + frete + seguro + outras despesas − desconto. Os campos separados
// ficam disponíveis somente para evidência e auditoria, sem dupla contagem.
function valorDocumental(movimento = {}) {
  return numero(movimento.valor);
}

function valor(valor, natureza = 'REAL') {
  return tem(valor) ? { valor: numero(valor), natureza } : { valor: null, natureza: 'INDETERMINADO' };
}

function tabelaExiste(db, nome) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(nome));
}

// Demonstra, por competência, a memória que validou a transferência do
// PGDAS para o Perfil Tributário. Os valores do perfil continuam sendo os
// declarados no PGDAS; o cálculo de competência é apresentado separadamente.
function montarComposicaoPisCofinsPgdas(db, empresaId, perfis, noExercicio) {
  if (!tabelaExiste(db, 'pgdas_documentos') || !tabelaExiste(db, 'pgdas_documento_campos')) return [];
  const documentos = db.prepare(`SELECT * FROM pgdas_documentos WHERE empresa_id=? AND status_processamento='VALIDADO_USUARIO' ORDER BY id DESC`).all(empresaId);
  const campos = db.prepare(`SELECT c.* FROM pgdas_documento_campos c JOIN pgdas_documentos d ON d.id=c.documento_id WHERE d.empresa_id=?`).all(empresaId);
  const perfilPorCompetencia = new Map(perfis.map((x) => [x.competencia, x]));
  const vistos = new Set(), linhas = [];
  for (const documento of documentos) {
    const camposDocumento = campos.filter((x) => Number(x.documento_id) === Number(documento.id));
    const bruto = Object.fromEntries(camposDocumento.map((x) => [x.campo, x.valor_extraido]));
    const competencia = bruto.competencia || documento.competencia_detectada;
    if (!competencia || vistos.has(competencia) || !noExercicio(competencia)) continue;
    vistos.add(competencia);
    let blocos = [];
    try { blocos = JSON.parse(bruto.revenue_blocks || '[]'); } catch (_) { continue; }
    const valores = { ...bruto, competencia, rbt12: numero(bruto.rbt12), receita_bruta: numero(bruto.receita_bruta), receita_recebida: bruto.receita_recebida == null ? null : numero(bruto.receita_recebida), pis: numero(bruto.pis), cofins: numero(bruto.cofins) };
    const validacao = pgdasDocumentoIa.validarRegraBlocos(db, valores, blocos);
    const calculoCompetencia = pgdasDocumentoIa.calcularCompetenciaPisCofins(db, empresaId, valores, validacao);
    const perfil = perfilPorCompetencia.get(competencia) || {};
    for (const bloco of validacao.blocos || []) {
      const regra = bloco.calculation || {}, aceite = bloco.aceite_tributario || {};
      linhas.push({ competencia, documento: documento.nome_original, status: validacao.validada ? 'VALIDADO' : 'REVISAR',
        descricao_bloco: bloco.description_raw, receita_pgdas: numero(bloco.revenue_amount), receita_competencia: (calculoCompetencia?.memoria || []).find((x) => x.anexo === bloco.anexo)?.receita_competencia ?? null,
        anexo: aceite.anexo, rbt12: aceite.rbt12, faixa: aceite.faixa, aliquota_nominal: aceite.aliquota_nominal,
        parcela_deduzir: aceite.parcela_deduzir, simples_effective_rate: aceite.aliquota_efetiva_simples,
        pis_distribution_percentage: aceite.pis_distribution_percentage, pis_effective_rate: aceite.pis_effective_rate,
        cofins_distribution_percentage: aceite.cofins_distribution_percentage, cofins_effective_rate: aceite.cofins_effective_rate,
        pgdas_pis: aceite.pgdas_pis, calculated_pis: aceite.calculated_pis, pis_match: aceite.pis_match,
        pgdas_cofins: aceite.pgdas_cofins, calculated_cofins: aceite.calculated_cofins, cofins_match: aceite.cofins_match,
        pis_perfil: perfil.pis ?? null, cofins_perfil: perfil.cofins ?? null,
        calculo_competencia_status: calculoCompetencia?.status || 'NAO_CALCULADO',
        pis_competencia: calculoCompetencia?.pis ?? null, cofins_competencia: calculoCompetencia?.cofins ?? null,
      });
    }
  }
  const competenciasExibidas = new Set();
  return linhas
    .sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)) || String(a.descricao_bloco).localeCompare(String(b.descricao_bloco)))
    .map((linha) => {
      // PIS/Cofins do Perfil é o total do mês, não um total por bloco. A
      // marca impede que a mesma cifra seja repetida visualmente em locação,
      // serviços e revenda, sem alterar nenhum cálculo ou lançamento.
      const exibirTotalPerfil = !competenciasExibidas.has(linha.competencia);
      competenciasExibidas.add(linha.competencia);
      return { ...linha, exibir_total_perfil: exibirTotalPerfil };
    });
}

// Confronto estritamente informativo entre as fontes que já foram importadas.
// Não há estimativa nem alteração de dado fiscal: uma divergência apenas pede
// conferência do responsável antes de usar os números em uma decisão.
function montarAuditoriaMensal(documentos, apuracoes, perfis, receitasSemDfe = [], deducoesDevolucoes = []) {
  const porCompetencia = new Map();
  const obter = (competencia) => {
    if (!porCompetencia.has(competencia)) porCompetencia.set(competencia, { competencia, documentos: null, outras_receitas: null, pis_cofins: null, pgdas: null });
    return porCompetencia.get(competencia);
  };
  (documentos || []).forEach((x) => {
    if (numero(x.quantidade_documentos) > 0) obter(x.competencia).documentos = {
      valor: numero(x.receita_documentada), quantidade: numero(x.quantidade_documentos), fonte: 'Documentos fiscais importados',
    };
  });
  (receitasSemDfe || []).filter((x) => x.status_validacao !== 'POSSIVEL_DUPLICIDADE').forEach((x) => {
    const atual = obter(x.competencia);
    const outras = atual.outras_receitas || { valor: 0, quantidade: 0, fonte: 'Outras receitas importadas' };
    outras.valor += numero(x.valor); outras.quantidade++;
    atual.outras_receitas = outras;
  });
  // Devolução de venda é classificada no Mapa de CFOP como redução de
  // faturamento. Ela não pode virar venda nem "outra receita"; os documentos
  // que comprovam a dedução permanecem expostos na memória.
  (deducoesDevolucoes || []).forEach((x) => {
    const atual = obter(x.competencia);
    const deducoes = atual.deducoes_devolucoes || { valor: 0, quantidade: 0, fonte: 'Devoluções de venda configuradas no Mapa de CFOP', itens: [] };
    deducoes.valor += numero(x.valor);
    deducoes.quantidade++;
    deducoes.itens.push({ documento:x.documento || null, chave:x.chave || null, cfop:x.cfop || null, descricao:x.descricao || null, valor:numero(x.valor), modelo:x.modelo_documento_fiscal || null, data_emissao:x.data_emissao || null });
    atual.deducoes_devolucoes = deducoes;
  });
  (apuracoes || []).forEach((x) => {
    const atual = obter(x.competencia);
    // Havendo reprocessamentos do mesmo mês, a leitura mais recente é a que
    // representa a evidência exibida ao usuário.
    if (!atual.pis_cofins) atual.pis_cofins = {
      valor: x.receita_base == null ? null : numero(x.receita_base), documento: x.nome_original || null,
      validacao: x.status_validacao || 'INDETERMINADO', fonte: 'Apuração PIS/Cofins importada',
    };
  });
  (perfis || []).forEach((x) => {
    if (!/^pgdas_/i.test(String(x.origem || ''))) return;
    const atual = obter(x.competencia);
    if (!atual.pgdas) atual.pgdas = {
      valor: x.receita_bruta == null ? null : numero(x.receita_bruta), origem: x.origem,
      fonte: 'PGDAS importado',
    };
    if (x.receita_recebida != null) atual.receita_recebida = { valor: numero(x.receita_recebida), fonte: 'PGDAS — regime de caixa' };
  });
  return [...porCompetencia.values()].sort((a, b) => String(a.competencia).localeCompare(String(b.competencia))).map((linha) => {
    const documentosImportados = linha.documentos?.valor ?? null;
    const outrasReceitas = linha.outras_receitas?.valor ?? null;
    const devolucoes = linha.deducoes_devolucoes?.valor ?? 0;
    const receitaAnalisada = documentosImportados === null && outrasReceitas === null && !linha.deducoes_devolucoes
      ? null : numero(documentosImportados) + numero(outrasReceitas) - devolucoes;
    const bases = [linha.pis_cofins, linha.pgdas].filter(Boolean);
    const basesComValor = bases.filter((x) => x.valor !== null);
    const diferencas = basesComValor.map((x) => ({ fonte: x.fonte, valor: x.valor - receitaAnalisada }));
    let situacao = 'SEM_APURACAO_IMPORTADA';
    if (receitaAnalisada === null) situacao = bases.length ? 'SEM_DOCUMENTOS_DE_RECEITA' : 'SEM_DADOS_PARA_CONFRONTO';
    else if (bases.length && !basesComValor.length) situacao = 'RECEITA_NAO_INFORMADA_NA_APURACAO';
    else if (basesComValor.length && diferencas.every((x) => Math.abs(x.valor) < 0.01)) situacao = 'CONCILIADO';
    else if (basesComValor.length) situacao = 'DIVERGENCIA_A_CONFERIR';
    return { ...linha, receita_analisada: receitaAnalisada, diferencas, situacao };
  });
}

function consolidar(db, empresaId, opcoes = {}) {
  const colunasEmpresa = new Set(db.prepare('PRAGMA table_info(empresas)').all().map((x) => x.name));
  const colunaEmpresa = (nome) => colunasEmpresa.has(nome) ? nome : `NULL AS ${nome}`;
  const empresa = db.prepare(`SELECT id, razao_social, ${colunaEmpresa('regime')}, ${colunaEmpresa('regime_reconhecimento_simples')} FROM empresas WHERE id=?`).get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');
  const periodo = tabelaExiste(db, 'empresa_periodo_analisado')
    ? db.prepare('SELECT competencia_inicio,competencia_fim FROM empresa_periodo_analisado WHERE empresa_id=?').get(empresaId) : null;
  const noExercicio = (competencia) => !periodo || (competencia >= periodo.competencia_inicio && competencia <= periodo.competencia_fim);

  const perfis = db.prepare('SELECT * FROM perfil_tributario WHERE empresa_id=? AND COALESCE(competencia,\'\')<>\'\' ORDER BY competencia').all(empresaId).filter((x) => noExercicio(x.competencia));
  const folhas = db.prepare('SELECT * FROM folhas_pagamento_competencias WHERE empresa_id=?').all(empresaId).filter((x) => noExercicio(x.competencia));
  const margens = db.prepare('SELECT * FROM margens_operacionais_premissas WHERE empresa_id=?').all(empresaId);
  const receitasSemDfe = db.prepare('SELECT * FROM receitas_sem_dfe WHERE empresa_id=?').all(empresaId).filter((x) => noExercicio(x.competencia));
  const cbs = db.prepare('SELECT * FROM perfil_cbs_competencias WHERE empresa_id=?').all(empresaId);
  const documentosPorCompetencia = new Map();
  const composicaoReceita = new Map();
  // Bases antigas podem ainda não ter recebido as colunas fiscais mais
  // recentes. A leitura continua segura (NULL não presume venda) enquanto a
  // migração local é concluída.
  const colunasMovimentos = new Set(db.prepare('PRAGMA table_info(movimentos)').all().map((x) => x.name));
  const colunaMovimento = (nome) => colunasMovimentos.has(nome) ? nome : `NULL AS ${nome}`;
  const movimentosFonte = Array.isArray(opcoes.movimentos)
    ? opcoes.movimentos
    : db.prepare(`SELECT competencia,valor,iss,tipo,sentido,${colunaMovimento('documento')},${colunaMovimento('chave')},${colunaMovimento('descricao')},${colunaMovimento('data_emissao')},${colunaMovimento('frete')},${colunaMovimento('seguro')},${colunaMovimento('outras')},${colunaMovimento('desconto')},${colunaMovimento('cfop')},${colunaMovimento('nbs')},${colunaMovimento('lc116')},${colunaMovimento('modelo_documento_fiscal')},${colunaMovimento('situacao_documento')},${colunaMovimento('normalizacao_evidencia')}
      FROM movimentos WHERE empresa_id=? AND COALESCE(competencia,'')<>''`).all(empresaId);
  const deducoesDevolucoes = [];
  movimentosFonte
    .filter((x) => Number(x.empresa_id || empresaId) === Number(empresaId) && String(x.competencia || '') !== '')
    .filter((x) => receitaOperacional.ehSaida(x) && noExercicio(x.competencia))
    .forEach((x) => {
      const atual=documentosPorCompetencia.get(x.competencia) || { competencia:x.competencia, receita_documentada:0, quantidade_documentos:0, iss_documentado:0 };
      // Defesa explícita da composição: retorno de remessa e documento
      // inválido jamais passam para a receita, ainda que um de-para antigo de
      // CFOP tenha ficado salvo na base.
      const cfop=receitaOperacional.cfopEfetivo(x);
      const situacao=String(x.situacao_documento || 'AUTORIZADO').toUpperCase();
      const compoe = receitaOperacional.compoeReceita(x)
        && !['5916','6916'].includes(cfop)
        && !['CANCELADO','DENEGADO','INUTILIZADO'].includes(situacao);
      const motivo = receitaOperacional.motivo(x);
      // Não misturar, no mesmo grupo visual, documentos que compõem receita
      // com documentos excluídos. Antes, uma NF-e cancelada com o mesmo CFOP
      // de uma venda era somada ao grupo de vendas já criado e herdava seu
      // `compoe_receita=true`, embora a própria linha estivesse cancelada.
      const classificacaoComposicao = compoe ? 'COMPOE_RECEITA' : `NAO_COMPOE_${situacao}`;
      const chave = [x.competencia, x.modelo_documento_fiscal || 'NAO_IDENTIFICADO', cfop || 'SEM_CFOP', motivo, classificacaoComposicao].join('|');
      const linha = composicaoReceita.get(chave) || { competencia:x.competencia, modelo_fiscal:x.modelo_documento_fiscal || 'NAO_IDENTIFICADO', cfop, motivo, compoe_receita:compoe, itens:0, valor:0 };
      const valorDaLinha = valorDocumental(x);
      linha.itens++; linha.valor += valorDaLinha; composicaoReceita.set(chave, linha);
      if (compoe) {
        atual.receita_documentada += valorDaLinha; atual.quantidade_documentos++; atual.iss_documentado += numero(x.iss);
      }
      documentosPorCompetencia.set(x.competencia,atual);
    });
  movimentosFonte
    .filter((x) => Number(x.empresa_id || empresaId) === Number(empresaId) && String(x.competencia || '') !== '')
    .filter((x) => noExercicio(x.competencia))
    .filter((x) => receitaOperacional.efeitoBase(x) === 'REDUZ_FATURAMENTO')
    .filter((x) => !['CANCELADO', 'DENEGADO', 'INUTILIZADO'].includes(String(x.situacao_documento || '').toUpperCase()))
    .forEach((x) => deducoesDevolucoes.push({ ...x, cfop:receitaOperacional.cfopEfetivo(x), valor:valorDocumental(x) }));
  const documentos=[...documentosPorCompetencia.values()];
  const apuracoes = tabelaExiste(db, 'pis_cofins_apuracoes_historicas')
    ? db.prepare(`SELECT a.*, d.nome_original, d.hash_sha256 FROM pis_cofins_apuracoes_historicas a
      JOIN pis_cofins_apuracao_documentos d ON d.id=a.documento_id
      WHERE a.empresa_id=? AND COALESCE(a.competencia,'')<>'' ORDER BY a.id DESC`).all(empresaId).filter((x) => noExercicio(x.competencia))
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
    // Outras receitas confirmadas são fatos econômicos fora do XML/DF-e e
    // integram a base do Perfil. Possíveis duplicidades continuam fora até a
    // revisão para não inflar a receita analisada.
    const receitasComplementaresValidas=(linha.receitas_sem_dfe || []).filter((x)=>x.status_validacao!=='POSSIVEL_DUPLICIDADE');
    const receitaSemDfe = receitasComplementaresValidas.reduce((s, x) => s + numero(x.valor), 0);
    const tributosHistoricos = p ? numero(p.icms) + numero(p.iss) + numero(p.ipi) + numero(p.pis) + numero(p.cofins) + numero(p.das) : null;
    const margem = margens.find((x) => x.periodo_inicio <= linha.competencia && x.periodo_fim >= linha.competencia) || null;
    const eSimples = /simples|mei/.test(String(empresa.regime || '').toLowerCase());
    const eLucroReal = /lucro_real|lucro real/.test(String(empresa.regime || '').toLowerCase());
    const cbsAtual = linha.cbs || null;
    const especiais = cbsAtual ? numero(cbsAtual.receita_reducao_cbs) + numero(cbsAtual.receita_aliquota_zero_cbs)
      + numero(cbsAtual.receita_imunidade_cbs) + numero(cbsAtual.receita_regime_especifico_cbs)
      + numero(cbsAtual.receita_beneficio_governo_cbs) : null;
    const apuracao = linha.apuracao_pis_cofins || null;
    // Para a receita do Perfil, o XML mensal é a fonte primária quando existe:
    // ele incorpora documentos novos assim que são importados. A apuração
    // Questor é fallback; um perfil manual nunca pode sobrescrever XMLs da
    // mesma competência nem somar meses fora da janela.
    const receitaApuracao = apuracao?.receita_base != null ? numero(apuracao.receita_base) : null;
    // Receita do Perfil é sempre documental (XML, SPED ou planilha fiscal).
    // PGDAS é evidência de carga e de auditoria; nunca substitui faturamento.
    // Em caixa, somente o denominador da carga efetiva usa receita recebida.
    const simplesCaixa = eSimples && empresa.regime_reconhecimento_simples === 'caixa';
    const receitaAtual = receitaDocumentada === null && !receitasComplementaresValidas.length ? null : numero(receitaDocumentada) + receitaSemDfe;
    const receitaRecebida = p?.receita_recebida != null ? numero(p.receita_recebida) : null;
    const receitaParaCarga = simplesCaixa ? receitaRecebida : receitaAtual;
    const apuracaoConfirmada = ['VALIDADO_USUARIO','VALIDADO_AUTOMATICAMENTE'].includes(apuracao?.status_validacao)
      && (apuracao.pis_recolhido != null || apuracao.pis_debito != null)
      && (apuracao.cofins_recolhida != null || apuracao.cofins_debito != null);
    const cargaPisCofinsAtual = apuracaoConfirmada
      ? { valor: numero(apuracao.pis_recolhido ?? apuracao.pis_debito) + numero(apuracao.cofins_recolhida ?? apuracao.cofins_debito), natureza: 'REAL', origem: apuracao.status_validacao === 'VALIDADO_USUARIO' ? 'APURACAO_CONFIRMADA' : 'APURACAO_VALIDADA_AUTOMATICAMENTE' }
      : p ? { valor: numero(p.pis) + numero(p.cofins), natureza: 'REAL', origem: 'PERFIL_HISTORICO' }
        : { valor: null, natureza: 'INDETERMINADO', origem: 'INDETERMINADO' };
    return {
      competencia: linha.competencia,
      regime: empresa.regime || 'INDETERMINADO',
      receita: valor(receitaAtual, receitaDocumentada !== null ? 'DOCUMENTO_FISCAL_IMPORTADO' : receitasComplementaresValidas.length ? 'OUTRA_RECEITA_CONFIRMADA' : 'INDETERMINADO'),
      receita_documentada: valor(receitaDocumentada, receitaDocumentada !== null ? 'EXTRAIDO' : 'INDETERMINADO'),
      receita_recebida: valor(receitaRecebida, receitaRecebida !== null ? 'PGDAS_CAIXA' : simplesCaixa ? 'INDETERMINADO' : 'NAO_APLICAVEL'),
      folha: valor(linha.folha?.valor_folha, linha.folha ? 'REAL' : 'INDETERMINADO'),
      margem_operacional: valor(margem?.margem_operacional_percentual, margem ? 'PREMISSA_INFORMADA' : 'INDETERMINADO'),
      composicao_receitas: p ? {
        mercadorias: valor(p.receita_mercadorias), servicos: valor(p.receita_servicos), exportacao: valor(p.receita_exportacao),
      } : { natureza: 'INDETERMINADO' },
      // Mantém a abertura dos registros para a tela de composição poder
      // demonstrar que esses valores também formam a receita do Perfil.
      receitas_sem_dfe: { valor: receitasComplementaresValidas.length ? receitaSemDfe : null, natureza: receitasComplementaresValidas.length ? 'REAL' : 'INDETERMINADO', registros: receitasComplementaresValidas.length, itens: receitasComplementaresValidas.map((x) => ({ id:x.id, tipo_receita:x.tipo_receita, descricao:x.descricao, valor:numero(x.valor), origem:x.origem, evidencia:x.evidencia, identificador_origem:x.identificador_origem })) },
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
  const auditoria_mensal = montarAuditoriaMensal(documentos, apuracoes, perfis, receitasSemDfe, deducoesDevolucoes);
  const composicao_pis_cofins_pgdas = montarComposicaoPisCofinsPgdas(db, empresaId, perfis, noExercicio);
  return { empresa: { id: empresa.id, nome: empresa.razao_social, regime_atual: empresa.regime || 'INDETERMINADO', regime_reconhecimento_simples: empresa.regime_reconhecimento_simples || 'competencia' }, cobertura, historico, auditoria_mensal, composicao_receita:[...composicaoReceita.values()].sort((a,b)=>b.valor-a.valor), composicao_pis_cofins_pgdas };
}

module.exports = { consolidar, montarAuditoriaMensal, montarComposicaoPisCofinsPgdas };

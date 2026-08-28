/**
 * Telemetria de autonomia.
 *
 * Leitura paralela aos resultados fiscais: não recalcula nem altera tributos,
 * classificação, base econômica ou crédito. Ela somente traduz a memória já
 * persistida para uma fila operacional explícita.
 */
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r4 = (v) => Math.round(n(v) * 10000) / 10000;

const ESTADOS = Object.freeze({
  AUTOMATICO: 'RESOLVIDO_AUTOMATICAMENTE',
  EVIDENCIA: 'RESOLVIDO_POR_EVIDENCIA',
  PREMISSA: 'RESOLVIDO_POR_PREMISSA',
  INDETERMINADO: 'INDETERMINADO_AUTOMATICAMENTE',
  HUMANO: 'REQUER_INTERVENCAO_HUMANA',
});

function detalhe(linha) {
  if (linha?.detalhe && typeof linha.detalhe === 'object') return linha.detalhe;
  try { return JSON.parse(linha?.detalhe || '{}'); } catch (_) { return {}; }
}

function causaClassificacao(linha, d) {
  const c = d.classificacao || {};
  const fundamentos = JSON.stringify(c.fundamentos || []).toLowerCase();
  if (!linha.ncm && !linha.nbs) return linha.sentido === 'saida' ? 'NBS_AUSENTE' : 'NCM_AUSENTE';
  if ((c.candidatos || []).length > 1 || fundamentos.includes('mais de uma')) return 'CLASSIFICACAO_AMBIGUA';
  if (fundamentos.includes('governo') || fundamentos.includes('condição legal')) return 'CONDICAO_LEGAL_NAO_COMPROVADA';
  if (fundamentos.includes('remessa') || fundamentos.includes('devolução') || fundamentos.includes('transferência') || fundamentos.includes('ativo')) return 'OPERACAO_ESPECIAL';
  return 'CLASSIFICACAO_AMBIGUA';
}

function avaliar(linha) {
  const d = detalhe(linha);
  const rec = d.reconstrucao || {};
  const statusClassificacao = String(linha.status_classificacao || '').toUpperCase();
  const statusCredito = String(linha.status_credito_determinacao || linha.status_credito || '').toUpperCase();
  const reconstrucao = String(rec.status || '').toLowerCase();
  const fundamento = (d.classificacao?.fundamentos || []).filter(Boolean).join(' ');
  const origemClassificacao = d.classificacao?.origem || null;
  const regra = linha.regra_version || d.classificacao?.origem || null;

  // A precedência abaixo é de autonomia, nunca de tributação.
  if (statusClassificacao === 'REQUER_VALIDACAO' || statusClassificacao === 'SEM_CORRESPONDENCIA') {
    const causa = causaClassificacao(linha, d);
    return { estado_autonomia: ESTADOS.HUMANO, codigo_causa: causa,
      origem_resolucao: origemClassificacao || 'NAO_DETERMINAVEL_HISTORICAMENTE',
      evidencia_utilizada: fundamento || null, regra_vencedora: regra,
      requer_intervencao_humana: 1, motivo_intervencao: 'Classificação fiscal não concluída com os fatos disponíveis.' };
  }
  if (['parcialmente_determinada', 'insuficiente'].includes(reconstrucao)) {
    return { estado_autonomia: ESTADOS.HUMANO, codigo_causa: 'EVIDENCIA_BASE_INSUFICIENTE',
      origem_resolucao: rec.memoriaPisCofins?.base_reconstrucao_fonte || 'NAO_DETERMINAVEL_HISTORICAMENTE',
      evidencia_utilizada: (rec.pendencias || []).join(' ') || null, regra_vencedora: regra,
      requer_intervencao_humana: 1, motivo_intervencao: 'Base econômica depende de evidência documental ou cadastral complementar.' };
  }
  if (['SUJEITO_VALIDACAO', 'DADOS_INSUFICIENTES'].includes(statusCredito)) {
    return { estado_autonomia: ESTADOS.HUMANO, codigo_causa: 'CONDICAO_LEGAL_NAO_COMPROVADA',
      origem_resolucao: 'NAO_DETERMINAVEL_HISTORICAMENTE', evidencia_utilizada: null, regra_vencedora: regra,
      requer_intervencao_humana: 1, motivo_intervencao: 'Elegibilidade do crédito não foi comprovada.' };
  }
  if (statusClassificacao === 'INDETERMINADO' || statusCredito === 'INDETERMINADO' || String(linha.natureza).toUpperCase() === 'INDETERMINADO') {
    return { estado_autonomia: ESTADOS.INDETERMINADO, codigo_causa: 'EVIDENCIA_INSUFICIENTE',
      origem_resolucao: 'NAO_DETERMINAVEL_HISTORICAMENTE', evidencia_utilizada: null, regra_vencedora: regra,
      requer_intervencao_humana: 0, motivo_intervencao: null };
  }
  if (statusCredito === 'DETERMINADO_POR_PREMISSA' || reconstrucao === 'estimada') {
    return { estado_autonomia: ESTADOS.PREMISSA, codigo_causa: null,
      origem_resolucao: rec.memoriaPisCofins?.carga_atual_pis_cofins_origem || 'PARAMETRO',
      evidencia_utilizada: rec.memoriaPisCofins?.fundamento || null, regra_vencedora: regra,
      requer_intervencao_humana: 0, motivo_intervencao: null };
  }
  // Catálogo/regra determinística é resolução automática. Documento, SPED e
  // referência cadastrada permanecem distinguíveis como resolução por evidência.
  // Quando a fotografia histórica não registra a origem, não inventamos a fonte:
  // apenas registramos que não exigiu ação humana naquela execução.
  const origemNormalizada = String(origemClassificacao || '').toUpperCase();
  const porEvidencia = ['DOCUMENTO', 'SPED', 'REFERENCIA_EMPRESA', 'CADASTRO_REGIME', 'MANUAL'].includes(origemNormalizada);
  return { estado_autonomia: porEvidencia ? ESTADOS.EVIDENCIA : ESTADOS.AUTOMATICO, codigo_causa: null,
    origem_resolucao: origemClassificacao || 'NAO_DETERMINAVEL_HISTORICAMENTE',
    evidencia_utilizada: fundamento || null, regra_vencedora: regra,
    requer_intervencao_humana: 0, motivo_intervencao: null };
}

function consolidar(linhas) {
  const total = linhas.length;
  const contagem = Object.fromEntries(Object.values(ESTADOS).map((x) => [x, 0]));
  linhas.forEach((linha) => { const estado = linha.estado_autonomia || avaliar(linha).estado_autonomia; contagem[estado] = (contagem[estado] || 0) + 1; });
  const autonomas = total - contagem[ESTADOS.HUMANO];
  return { meta_autonomia: .95, total_operacoes: total, operacoes_autonomas: autonomas,
    operacoes_intervencao: contagem[ESTADOS.HUMANO], estados: contagem,
    taxa_autonomia: total ? r4(autonomas / total) : null,
    taxa_determinacao: total ? r4((contagem[ESTADOS.AUTOMATICO] + contagem[ESTADOS.EVIDENCIA]) / total) : null,
    taxa_simulacao: total ? r4(contagem[ESTADOS.PREMISSA] / total) : null,
    taxa_indeterminacao_automatica: total ? r4(contagem[ESTADOS.INDETERMINADO] / total) : null,
    taxa_intervencao_humana: total ? r4(contagem[ESTADOS.HUMANO] / total) : null,
    meta_atingida: autonomas >= Math.ceil(total * .95) };
}

function obter(db, empresaId) {
  const execucao = db.prepare('SELECT id FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(empresaId);
  if (!execucao) return { execucao_id: null, total_operacoes: 0, operacoes_autonomas: 0, operacoes_intervencao: 0 };
  const persistida = db.prepare('SELECT * FROM telemetria_autonomia_execucoes WHERE execucao_id=?').get(execucao.id);
  if (persistida) {
    let estados = {}; try { estados = JSON.parse(persistida.estados_json || '{}'); } catch (_) { /* leitura resiliente */ }
    return { ...persistida, execucao_id: execucao.id, estados, meta_atingida: Number(persistida.taxa_autonomia) >= Number(persistida.meta_autonomia) };
  }
  return { execucao_id: execucao.id, ...consolidar(db.prepare('SELECT * FROM motor_resultados WHERE empresa_id=? AND execucao_id=?').all(empresaId, execucao.id)) };
}

module.exports = { ESTADOS, avaliar, consolidar, obter };

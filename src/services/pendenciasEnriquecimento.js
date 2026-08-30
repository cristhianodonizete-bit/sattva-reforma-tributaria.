/**
 * Contrato de pendências de enriquecimento fiscal.
 *
 * Não decide tributo. Ele apenas traduz uma indeterminação já produzida pelo
 * motor em evidências objetivas que poderiam resolvê-la numa execução futura.
 */
const MOTIVOS = Object.freeze([
  'SEM_CATALOGO', 'SEM_EVIDENCIA', 'MULTIPLOS_CANDIDATOS',
  'SEM_BASE_PIS_COFINS', 'SEM_NBS', 'SEM_REGRA_APLICAVEL',
  'REGRA_INCONCLUSIVA',
]);

function normalizarMotivo(valor) {
  const motivo = String(valor || '').trim().toUpperCase();
  return MOTIVOS.includes(motivo) ? motivo : 'SEM_EVIDENCIA';
}

function evidenciaNecessaria(motivo, tipo = 'FISCAL') {
  const chave = normalizarMotivo(motivo);
  const servico = String(tipo).toUpperCase() === 'SERVICO';
  const mapa = {
    SEM_CATALOGO: servico ? ['CATALOGO_OFICIAL', 'NBS_OU_LC116_VALIDADO'] : ['CATALOGO_OFICIAL', 'NCM_VALIDADO'],
    SEM_EVIDENCIA: servico ? ['DOCUMENTO_FISCAL', 'CADASTRO_MESTRE_VALIDADO'] : ['DOCUMENTO_FISCAL', 'CADASTRO_MESTRE_VALIDADO'],
    MULTIPLOS_CANDIDATOS: ['INDOP', 'ONEROSIDADE', 'EXTERIOR', 'LOCAL_INCIDENCIA', 'CCLASSTRIB'],
    SEM_BASE_PIS_COFINS: ['PIS_DOCUMENTADO', 'COFINS_DOCUMENTADA', 'SPED_OU_REFERENCIA_FISCAL_VALIDADA'],
    SEM_NBS: ['NBS_ORIGINAL', 'INDOP', 'CADASTRO_SERVICO_VALIDADO'],
    SEM_REGRA_APLICAVEL: ['REGRA_VERSIONADA_APLICAVEL'],
    REGRA_INCONCLUSIVA: ['CONDICAO_LEGAL_COMPROVADA', 'REGRA_VERSIONADA_APLICAVEL'],
  };
  return mapa[chave];
}

function pendenciaDaIndeterminacao({ empresaId, movimentoId, resultadoId, motivo, tipo = 'FISCAL', prioridade = 'MEDIA', detalhe = {} }) {
  const codigo = normalizarMotivo(motivo);
  return {
    empresa_id: empresaId,
    movimento_id: movimentoId,
    resultado_id: resultadoId,
    tipo_pendencia: codigo,
    evidencia_necessaria: evidenciaNecessaria(codigo, tipo),
    prioridade,
    status: 'ABERTA',
    origem: 'MOTOR_FISCAL',
    detalhe,
  };
}

function parseDetalhe(linha) {
  if (linha && typeof linha.detalhe === 'object') return linha.detalhe;
  try { return JSON.parse(linha?.detalhe || '{}'); } catch (_) { return {}; }
}

function motivoDaLinha(linha) {
  const d = parseDetalhe(linha);
  const rec = d.reconstrucao || {};
  const memoria = rec.memoriaPisCofins || {};
  if (memoria.motivo_indeterminacao) return normalizarMotivo(memoria.motivo_indeterminacao);
  if (['insuficiente', 'parcialmente_determinada'].includes(String(rec.status || '').toLowerCase())) return 'SEM_BASE_PIS_COFINS';
  const status = String(linha.status_classificacao || d.classificacao?.status || '').toUpperCase();
  if (status === 'REQUER_VALIDACAO') return (d.classificacao?.candidatos || []).length > 1 ? 'MULTIPLOS_CANDIDATOS' : 'SEM_NBS';
  if (status === 'SEM_CORRESPONDENCIA') return 'SEM_CATALOGO';
  return null;
}

function sincronizar(db, empresaId, execucaoId) {
  const linhas = db.prepare('SELECT * FROM motor_resultados WHERE empresa_id=? AND execucao_id=?').all(empresaId, execucaoId);
  const inserir = db.prepare(`INSERT INTO pendencias_enriquecimento_fiscal
    (empresa_id,movimento_id,resultado_id,tipo_pendencia,evidencia_necessaria,prioridade,status,origem,detalhe)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(empresa_id,movimento_id,resultado_id,tipo_pendencia,status) DO NOTHING`);
  let criadas = 0;
  db.transaction(() => {
    for (const linha of linhas) {
      const motivo = motivoDaLinha(linha);
      if (!motivo) continue;
      const tipo = String(parseDetalhe(linha).tipo || '').toUpperCase() === 'SERVICO' ? 'SERVICO' : 'FISCAL';
      const p = pendenciaDaIndeterminacao({ empresaId, movimentoId: linha.movimento_id, resultadoId: linha.id, motivo, tipo,
        prioridade: ['SEM_BASE_PIS_COFINS', 'MULTIPLOS_CANDIDATOS'].includes(motivo) ? 'ALTA' : 'MEDIA',
        detalhe: { execucao_id: execucaoId, regra_tentada: parseDetalhe(linha).reconstrucao?.memoriaPisCofins?.base_reconstrucao_metodo || null } });
      const r = inserir.run(p.empresa_id, p.movimento_id, p.resultado_id, p.tipo_pendencia, JSON.stringify(p.evidencia_necessaria), p.prioridade, p.status, p.origem, JSON.stringify(p.detalhe));
      criadas += Number(r.changes || 0);
    }
  })();
  return criadas;
}

module.exports = { MOTIVOS, normalizarMotivo, evidenciaNecessaria, pendenciaDaIndeterminacao, motivoDaLinha, sincronizar };

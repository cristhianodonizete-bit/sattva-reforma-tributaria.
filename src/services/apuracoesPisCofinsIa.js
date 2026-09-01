/*
 * Ingestão auditável de apurações históricas de PIS/Cofins.
 *
 * Esta camada registra extração e validação; não calcula tributos, não altera
 * movimentos nem aciona o motor CBS. A IA só pode propor campos explicitamente
 * encontrados no documento, sempre acompanhados de localização e confiança.
 */
const crypto = require('crypto');

const CAMPOS_NUMERICOS = new Set([
  'receita_base', 'pis_debito', 'cofins_debito', 'pis_credito', 'cofins_credito',
  'pis_credito_utilizado', 'cofins_credito_utilizado', 'saldo_pis', 'saldo_cofins',
  'pis_recolhido', 'cofins_recolhida',
]);
const CAMPOS = ['competencia', 'regime_pis_cofins', 'receita_base', 'pis_debito', 'cofins_debito',
  'pis_credito', 'cofins_credito', 'pis_credito_utilizado', 'cofins_credito_utilizado',
  'saldo_pis', 'saldo_cofins', 'pis_recolhido', 'cofins_recolhida', 'observacoes'];
const STATUS = new Set(['VALIDADO_AUTOMATICAMENTE', 'REQUER_VALIDACAO', 'VALIDADO_USUARIO', 'INDETERMINADO']);

function texto(v) { return String(v ?? '').trim(); }
function numeroOuNulo(v, campo) {
  if (v === null || v === undefined || texto(v) === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${campo} extraído não é numérico.`);
  return n;
}
function competencia(v) {
  const valor = texto(v);
  if (!valor) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) throw new Error('Competência extraída deve usar AAAA-MM.');
  return valor;
}
function validarEmpresa(db, empresaId) {
  if (!db.prepare('SELECT 1 FROM empresas WHERE id=?').get(empresaId)) throw new Error('Empresa não encontrada.');
}
function extracaoCampo(campo, bruto = {}) {
  const entrada = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : { valor_extraido: bruto };
  const valor = campo === 'competencia' ? competencia(entrada.valor_extraido)
    : CAMPOS_NUMERICOS.has(campo) ? numeroOuNulo(entrada.valor_extraido, campo)
      : entrada.valor_extraido === null || entrada.valor_extraido === undefined || texto(entrada.valor_extraido) === '' ? null : texto(entrada.valor_extraido);
  const status = texto(entrada.status_validacao || (valor === null ? 'INDETERMINADO' : 'REQUER_VALIDACAO')).toUpperCase();
  if (!STATUS.has(status)) throw new Error(`Status inválido para ${campo}.`);
  const confianca = entrada.confianca === null || entrada.confianca === undefined || texto(entrada.confianca) === '' ? null : Number(entrada.confianca);
  if (confianca !== null && (!Number.isFinite(confianca) || confianca < 0 || confianca > 1)) throw new Error(`Confiança inválida para ${campo}.`);
  return {
    campo, valor_extraido: valor, origem_documento: texto(entrada.origem_documento) || null,
    pagina_ou_localizacao: texto(entrada.pagina_ou_localizacao) || null, rotulo_original: texto(entrada.rotulo_original) || null,
    confianca, metodo_extracao: texto(entrada.metodo_extracao || 'IA_LLM_NORMALIZACAO'), status_validacao: status,
  };
}

function validarConsistencia(campos) {
  const porCampo = Object.fromEntries(campos.map((x) => [x.campo, x.valor_extraido]));
  const divergencias = [];
  for (const [credito, utilizado] of [['pis_credito', 'pis_credito_utilizado'], ['cofins_credito', 'cofins_credito_utilizado']]) {
    if (porCampo[credito] !== null && porCampo[utilizado] !== null && porCampo[utilizado] > porCampo[credito]) {
      divergencias.push(`${utilizado} maior que ${credito}`);
    }
  }
  return divergencias;
}

function ingestao(db, empresaId, documento, camposBrutos) {
  validarEmpresa(db, empresaId);
  if (!Buffer.isBuffer(documento.conteudo_original)) throw new Error('Conteúdo original do documento é obrigatório.');
  const tipo = texto(documento.tipo_documento).toUpperCase();
  if (!['PDF', 'XLSX', 'CSV', 'RELATORIO_ERP'].includes(tipo)) throw new Error('Tipo de documento não suportado para apuração.');
  const hash = crypto.createHash('sha256').update(documento.conteudo_original).digest('hex');
  if (db.prepare('SELECT id FROM pis_cofins_apuracao_documentos WHERE empresa_id=? AND hash_sha256=?').get(empresaId, hash)) {
    throw new Error('Documento de apuração já foi ingerido para esta empresa.');
  }
  const campos = CAMPOS.map((campo) => extracaoCampo(campo, camposBrutos?.[campo]));
  const valores = Object.fromEntries(campos.map((x) => [x.campo, x.valor_extraido]));
  const divergencias = validarConsistencia(campos);
  const versao = texto(documento.versao_modelo_extracao || 'INDETERMINADO');
  const transacao = db.transaction(() => {
    const doc = db.prepare(`INSERT INTO pis_cofins_apuracao_documentos
      (empresa_id,nome_original,tipo_documento,mime_type,conteudo_original,hash_sha256,competencia_detectada,data_processamento,versao_modelo_extracao,status_processamento)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(empresaId, texto(documento.nome_original) || 'documento-sem-nome', tipo,
      texto(documento.mime_type) || null, documento.conteudo_original, hash, valores.competencia,
      new Date().toISOString(), versao, divergencias.length ? 'REQUER_VALIDACAO' : 'PROCESSADO');
    const apuracao = db.prepare(`INSERT INTO pis_cofins_apuracoes_historicas
      (empresa_id,documento_id,competencia,regime_pis_cofins,receita_base,pis_debito,cofins_debito,pis_credito,cofins_credito,pis_credito_utilizado,cofins_credito_utilizado,saldo_pis,saldo_cofins,pis_recolhido,cofins_recolhida,observacoes,status_validacao,divergencias)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(empresaId, doc.lastInsertRowid, valores.competencia,
      valores.regime_pis_cofins, valores.receita_base, valores.pis_debito, valores.cofins_debito, valores.pis_credito,
      valores.cofins_credito, valores.pis_credito_utilizado, valores.cofins_credito_utilizado, valores.saldo_pis,
      valores.saldo_cofins, valores.pis_recolhido, valores.cofins_recolhida, valores.observacoes,
      divergencias.length ? 'REQUER_VALIDACAO' : 'VALIDADO_AUTOMATICAMENTE', JSON.stringify(divergencias));
    const inserirCampo = db.prepare(`INSERT INTO pis_cofins_apuracao_campos
      (apuracao_id,campo,valor_extraido,origem_documento,pagina_ou_localizacao,rotulo_original,confianca,metodo_extracao,status_validacao)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const campo of campos) inserirCampo.run(apuracao.lastInsertRowid, campo.campo,
      campo.valor_extraido === null ? null : String(campo.valor_extraido), campo.origem_documento, campo.pagina_ou_localizacao,
      campo.rotulo_original, campo.confianca, campo.metodo_extracao, campo.status_validacao);
    return { documento_id: doc.lastInsertRowid, apuracao_id: apuracao.lastInsertRowid };
  });
  return { ...transacao(), hash_sha256: hash, campos, divergencias };
}

function listarParaRevisao(db, empresaId) {
  validarEmpresa(db, empresaId);
  const apuracoes = db.prepare(`SELECT a.*, d.nome_original,d.tipo_documento,d.hash_sha256,d.versao_modelo_extracao
    FROM pis_cofins_apuracoes_historicas a JOIN pis_cofins_apuracao_documentos d ON d.id=a.documento_id
    WHERE a.empresa_id=? ORDER BY a.competencia DESC,a.id DESC`).all(empresaId);
  const campos = db.prepare(`SELECT c.* FROM pis_cofins_apuracao_campos c JOIN pis_cofins_apuracoes_historicas a ON a.id=c.apuracao_id
    WHERE a.empresa_id=? ORDER BY c.apuracao_id,c.id`).all(empresaId);
  const porApuracao = new Map();
  for (const campo of campos) (porApuracao.get(campo.apuracao_id) || porApuracao.set(campo.apuracao_id, []).get(campo.apuracao_id)).push(campo);
  return apuracoes.map((a) => ({ ...a, campos_extraidos: porApuracao.get(a.id) || [], campos_pendentes: (porApuracao.get(a.id) || []).filter((x) => x.status_validacao !== 'VALIDADO_AUTOMATICAMENTE').map((x) => x.campo) }));
}

function promptExtracao(textoDocumento) {
  return `Extraia apenas valores expressos no documento de apuração PIS/Cofins. Não calcule, não infira e não substitua ausência por zero. Retorne JSON com a chave campos e, para cada campo abaixo, valor_extraido, origem_documento, pagina_ou_localizacao, rotulo_original, confianca (0 a 1), metodo_extracao e status_validacao. Campos: ${CAMPOS.join(', ')}. Se não existir, valor_extraido deve ser null e status_validacao INDETERMINADO. Documento:\n${String(textoDocumento).slice(0, 70000)}`;
}

module.exports = { CAMPOS, STATUS, ingestao, listarParaRevisao, promptExtracao, validarConsistencia };

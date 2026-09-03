/*
 * Leitura auditável de PGDAS. O Azure apenas torna o documento legível; esta
 * camada só reconhece rótulos e valores que estejam no próprio arquivo. Nada
 * é estimado e o Perfil Tributário só recebe a informação após confirmação.
 */
const crypto = require('crypto');

const CAMPOS = ['competencia', 'receita_bruta', 'receita_mercadorias', 'receita_servicos', 'receita_exportacao', 'das', 'pis', 'cofins'];
const NUMERICOS = new Set(CAMPOS.filter((x) => x !== 'competencia'));
const texto = (v) => String(v ?? '').trim();
const valorNumero = (v) => {
  const bruto = texto(v).replace(/R\$|\s/g, '').replace(/[^0-9,.-]/g, '');
  if (!bruto) return null;
  const normalizado = bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto;
  const n = Number(normalizado); return Number.isFinite(n) ? n : null;
};
const competencia = (v) => {
  const m = texto(v).match(/(\d{2})\/(\d{4})|(\d{4})-(\d{2})/);
  return !m ? null : m[1] ? `${m[2]}-${m[1]}` : `${m[3]}-${m[4]}`;
};

function normalizarTexto(textoDocumento, { localizacoes = [], metodo = 'NORMALIZACAO_DETERMINISTICA_AZURE' } = {}) {
  const saida = Object.fromEntries(CAMPOS.map((campo) => [campo, { campo, valor_extraido: null, rotulo_original: null, pagina_ou_localizacao: null, confianca: null, metodo_extracao: metodo, status_validacao: 'INDETERMINADO' }]));
  const regras = [
    ['competencia', /^(compet[eê]ncia|per[ií]odo|refer[eê]ncia)\s*[:\-]\s*(.+)$/i, competencia],
    ['receita_bruta', /^(receita\s+bruta(?:\s+total|\s+mensal)?)\s*[:\-]\s*(.+)$/i, valorNumero],
    ['receita_mercadorias', /^(receita\s+(?:de\s+)?(?:mercadorias|com[eé]rcio|ind[uú]stria))\s*[:\-]\s*(.+)$/i, valorNumero],
    ['receita_servicos', /^(receita\s+(?:de\s+)?servi[cç]os?)\s*[:\-]\s*(.+)$/i, valorNumero],
    ['receita_exportacao', /^(receita\s+(?:de\s+)?exporta[cç][aã]o)\s*[:\-]\s*(.+)$/i, valorNumero],
    ['das', /^((?:valor\s+)?das(?:\s+(?:a\s+recolher|apurado|recolhido))?)\s*[:\-]\s*(.+)$/i, valorNumero],
    ['pis', /^((?:valor\s+)?pis(?:\s+(?:a\s+recolher|apurado|recolhido))?)\s*[:\-]\s*(.+)$/i, valorNumero],
    ['cofins', /^((?:valor\s+)?cofins(?:\s+(?:a\s+recolher|apurada|recolhida))?)\s*[:\-]\s*(.+)$/i, valorNumero],
  ];
  for (const linha of String(textoDocumento || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    for (const [campo, regra, converter] of regras) {
      if (saida[campo].valor_extraido !== null) continue;
      const encontrado = linha.match(regra); if (!encontrado) continue;
      const valor = converter(encontrado[2]); if (valor === null) continue;
      const local = localizacoes.find((x) => String(x.texto || '').includes(linha));
      saida[campo] = { campo, valor_extraido: valor, rotulo_original: encontrado[1], pagina_ou_localizacao: local?.pagina ? `p. ${local.pagina}` : null, confianca: local?.confianca ?? 0.9, metodo_extracao: metodo, status_validacao: 'REQUER_VALIDACAO' };
    }
  }
  return CAMPOS.map((campo) => saida[campo]);
}

function ingerir(db, empresaId, documento, campos) {
  const empresa = db.prepare("SELECT id,regime FROM empresas WHERE id=?").get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');
  if (empresa.regime !== 'simples_nacional') throw new Error('O PGDAS é aplicável somente à empresa do Simples Nacional.');
  const hash = crypto.createHash('sha256').update(documento.conteudo_original).digest('hex');
  if (db.prepare('SELECT id FROM pgdas_documentos WHERE empresa_id=? AND hash_sha256=?').get(empresaId, hash)) throw new Error('Este documento PGDAS já foi enviado para esta empresa.');
  const porCampo = Object.fromEntries(campos.map((x) => [x.campo, x]));
  const competenciaDetectada = porCampo.competencia?.valor_extraido || null;
  const inserir = db.transaction(() => {
    const doc = db.prepare(`INSERT INTO pgdas_documentos (empresa_id,nome_original,tipo_documento,mime_type,conteudo_original,hash_sha256,competencia_detectada,data_processamento,metodo_extracao,status_processamento)
      VALUES (?,?,?,?,?,?,?,?,?, 'REQUER_VALIDACAO')`).run(empresaId, documento.nome_original, documento.tipo_documento, documento.mime_type || null, documento.conteudo_original, hash, competenciaDetectada, new Date().toISOString(), documento.metodo_extracao);
    const campo = db.prepare(`INSERT INTO pgdas_documento_campos (documento_id,campo,valor_extraido,rotulo_original,pagina_ou_localizacao,confianca,metodo_extracao,status_validacao)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const x of campos) campo.run(doc.lastInsertRowid, x.campo, x.valor_extraido === null ? null : String(x.valor_extraido), x.rotulo_original, x.pagina_ou_localizacao, x.confianca, x.metodo_extracao, x.status_validacao);
    return Number(doc.lastInsertRowid);
  });
  return { documento_id: inserir(), hash_sha256: hash, campos };
}

function listar(db, empresaId) {
  const docs = db.prepare('SELECT * FROM pgdas_documentos WHERE empresa_id=? ORDER BY id DESC').all(empresaId);
  const campos = db.prepare(`SELECT c.* FROM pgdas_documento_campos c JOIN pgdas_documentos d ON d.id=c.documento_id WHERE d.empresa_id=? ORDER BY c.id`).all(empresaId);
  return docs.map((d) => ({ ...d, campos_extraidos: campos.filter((c) => c.documento_id === d.id), campos_pendentes: campos.filter((c) => c.documento_id === d.id && c.status_validacao !== 'VALIDADO_USUARIO').map((c) => c.campo) }));
}

function confirmar(db, empresaId, documentoId) {
  const doc = db.prepare('SELECT * FROM pgdas_documentos WHERE id=? AND empresa_id=?').get(documentoId, empresaId);
  if (!doc) throw new Error('Documento PGDAS não encontrado para a empresa.');
  const campos = db.prepare('SELECT * FROM pgdas_documento_campos WHERE documento_id=?').all(documentoId);
  const valores = Object.fromEntries(campos.map((x) => [x.campo, x.valor_extraido === null ? null : (x.campo === 'competencia' ? x.valor_extraido : Number(x.valor_extraido))]));
  if (!valores.competencia || !Number.isFinite(valores.das)) throw new Error('Confirme somente quando competência e valor do DAS estiverem identificados no documento.');
  db.transaction(() => {
    const existente = db.prepare('SELECT id FROM perfil_tributario WHERE empresa_id=? AND competencia=? ORDER BY id DESC LIMIT 1').get(empresaId, valores.competencia);
    const camposPerfil = [valores.receita_bruta, valores.receita_mercadorias, valores.receita_servicos, valores.receita_exportacao, valores.pis, valores.cofins];
    if (existente) db.prepare(`UPDATE perfil_tributario SET receita_bruta=COALESCE(?,receita_bruta),receita_mercadorias=COALESCE(?,receita_mercadorias),receita_servicos=COALESCE(?,receita_servicos),receita_exportacao=COALESCE(?,receita_exportacao),pis=COALESCE(?,pis),cofins=COALESCE(?,cofins),das=?,origem='pgdas_azure_confirmado' WHERE id=?`).run(...camposPerfil, valores.das, existente.id);
    else db.prepare(`INSERT INTO perfil_tributario (empresa_id,competencia,receita_bruta,receita_mercadorias,receita_servicos,receita_exportacao,pis,cofins,das,origem) VALUES (?,?,?,?,?,?,?,?,?,'pgdas_azure_confirmado')`).run(empresaId, valores.competencia, ...camposPerfil, valores.das);
    db.prepare("UPDATE pgdas_documento_campos SET status_validacao='VALIDADO_USUARIO' WHERE documento_id=? AND valor_extraido IS NOT NULL").run(documentoId);
    db.prepare("UPDATE pgdas_documentos SET status_processamento='VALIDADO_USUARIO' WHERE id=?").run(documentoId);
  })();
  return listar(db, empresaId).find((x) => x.id === Number(documentoId));
}

module.exports = { CAMPOS, normalizarTexto, ingerir, listar, confirmar };

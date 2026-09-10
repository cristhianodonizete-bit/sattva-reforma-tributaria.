/*
 * Leitura auditável de PGDAS. O Azure apenas torna o documento legível; esta
 * camada só reconhece rótulos e valores que estejam no próprio arquivo. Nada
 * é estimado e o Perfil Tributário só recebe a informação após confirmação.
 */
const crypto = require('crypto');

const CAMPOS = ['competencia', 'receita_bruta', 'receita_recebida', 'receita_mercadorias', 'receita_servicos', 'receita_exportacao', 'das', 'pis', 'cofins'];
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
  const reconhecer = (campo, valor, rotulo, confianca = 0.9) => {
    if (saida[campo].valor_extraido !== null || valor === null) return;
    const local = localizacoes.find((x) => String(x.texto || '').includes(rotulo));
    saida[campo] = { campo, valor_extraido: valor, rotulo_original: rotulo.slice(0, 180), pagina_ou_localizacao: local?.pagina ? `p. ${local.pagina}` : null, confianca, metodo_extracao: metodo, status_validacao: 'REQUER_VALIDACAO' };
  };
  const regras = [
    ['competencia', /^(compet[eê]ncia|per[ií]odo|refer[eê]ncia)\s*[:\-]\s*(.+)$/i, competencia],
    ['receita_bruta', /^(receita\s+bruta(?:\s+total|\s+mensal)?)\s*[:\-]\s*(.+)$/i, valorNumero],
    ['receita_recebida', /^(receita\s+(?:bruta\s+)?recebida(?:\s+no\s+caixa)?)\s*[:\-]\s*(.+)$/i, valorNumero],
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
  const linhas = String(textoDocumento || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const moedasNaLinha = (linha) => (String(linha || '').match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/g) || []).map(valorNumero).filter((x) => x !== null);
  // Layout oficial PGDAS-D: o resumo traz competência, caixa e débito na
  // mesma tabela. Não confundir esses números com o sublimite anual.
  const indiceResumo = linhas.findIndex((linha) => /receita\s+bruta\s+auferida/i.test(linha) && /receita\s+bruta\s+recebida/i.test(linha) && /d[eé]bito\s+declarado/i.test(linha));
  if (indiceResumo >= 0) {
    const valores = moedasNaLinha(linhas.slice(indiceResumo + 1, indiceResumo + 3).join(' | '));
    if (valores.length >= 3) {
      reconhecer('receita_bruta', valores[0], linhas[indiceResumo], 0.95);
      reconhecer('receita_recebida', valores[1], linhas[indiceResumo], 0.95);
      reconhecer('das', valores[2], linhas[indiceResumo], 0.95);
    }
  }
  // A última grade de "Total do Débito" é o consolidado da empresa. As
  // colunas são fixas no documento oficial: COFINS é a terceira e PIS a quarta.
  const cabecalhosTributos = linhas.map((linha, indice) => ({ linha, indice })).filter(({ linha }) => /IRPJ.*CSLL.*COFINS.*PIS\/Pasep/i.test(linha));
  for (const { linha, indice } of cabecalhosTributos) {
    const valores = moedasNaLinha(linhas.slice(indice + 1, indice + 3).join(' | '));
    if (valores.length >= 4) {
      reconhecer('cofins', valores[2], linha, 0.9);
      reconhecer('pis', valores[3], linha, 0.9);
    }
  }
  // Tabelas do PGDAS podem trazer o rótulo e o número em células/linhas
  // diferentes. Esta segunda passagem é intencionalmente conservadora: só
  // aceita moeda brasileira explícita e mantém o resultado para revisão.
  const rotulosTabela = {
    receita_bruta:/receita\s+bruta|receita\s+total/i,
    receita_recebida:/receita\s+recebida|regime\s+de\s+caixa/i,
    receita_mercadorias:/receita.*(?:mercadoria|com[eé]rcio|ind[uú]stria)/i,
    receita_servicos:/receita.*servi[cç]/i,
    receita_exportacao:/receita.*exporta|mercado\s+externo/i,
    das:/valor\s+total\s+do\s+d[eé]bito\s+declarado|total\s+do\s+d[eé]bito\s+exig[ií]vel|valor\s+(?:do\s+)?das\b|das\s+(?:a\s+recolher|apurado|recolhido)/i,
    pis:/\bpis(?:\/pasep)?\b/i,
    cofins:/\bcofins\b/i,
  };
  const moeda = /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/g;
  for (const [campo, rotulo] of Object.entries(rotulosTabela)) {
    if (saida[campo].valor_extraido !== null) continue;
    // Nunca use o bloco integral da página: ele reúne rótulos de várias
    // colunas e permitiria associar um "0,00" de outra rubrica à receita.
    const indice = linhas.findIndex((linha) => linha.length <= 240 && rotulo.test(linha));
    if (indice < 0) continue;
    // Em tabelas serializadas pelo Azure, rótulo e valor normalmente ficam
    // na mesma linha. Só olha as duas linhas seguintes se a própria linha
    // não trouxer uma moeda; isso impede, por exemplo, PIS virar receita.
    const valoresDaLinha = linhas[indice].match(moeda) || [];
    const proximaLinha = linhas[indice + 1] || '';
    // Só admite continuação em uma única linha numérica. Isso cobre tabelas
    // em que rótulo e valor estão em células separadas sem cruzar rubricas.
    const valores = valoresDaLinha.length ? valoresDaLinha : (/^(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(proximaLinha) ? [proximaLinha] : []);
    if (!valores.length) continue;
    const extraido = valorNumero(valores.at(-1));
    if (extraido === null) continue;
    const local = localizacoes.find((x) => String(x.texto || '').includes(linhas[indice]));
    saida[campo] = { campo, valor_extraido:extraido, rotulo_original:linhas[indice].slice(0, 180), pagina_ou_localizacao:local?.pagina ? `p. ${local.pagina}` : null, confianca:0.6, metodo_extracao:metodo, status_validacao:'REQUER_VALIDACAO' };
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

function reprocessarCampos(db, empresaId, documentoId, campos, metodo) {
  const doc = db.prepare('SELECT * FROM pgdas_documentos WHERE id=? AND empresa_id=?').get(documentoId, empresaId);
  if (!doc) throw new Error('Documento PGDAS não encontrado para reprocessamento.');
  db.transaction(() => {
    db.prepare('DELETE FROM pgdas_documento_campos WHERE documento_id=?').run(documentoId);
    const inserir = db.prepare(`INSERT INTO pgdas_documento_campos (documento_id,campo,valor_extraido,rotulo_original,pagina_ou_localizacao,confianca,metodo_extracao,status_validacao) VALUES (?,?,?,?,?,?,?,?)`);
    campos.forEach((x) => inserir.run(documentoId, x.campo, x.valor_extraido === null ? null : String(x.valor_extraido), x.rotulo_original, x.pagina_ou_localizacao, x.confianca, x.metodo_extracao, x.status_validacao));
    db.prepare("UPDATE pgdas_documentos SET metodo_extracao=?,data_processamento=?,status_processamento='REQUER_VALIDACAO' WHERE id=?").run(metodo || doc.metodo_extracao, new Date().toISOString(), documentoId);
  })();
  return listar(db, empresaId).find((x) => x.id === Number(documentoId));
}

function confirmar(db, empresaId, documentoId) {
  const doc = db.prepare('SELECT * FROM pgdas_documentos WHERE id=? AND empresa_id=?').get(documentoId, empresaId);
  if (!doc) throw new Error('Documento PGDAS não encontrado para a empresa.');
  const campos = db.prepare('SELECT * FROM pgdas_documento_campos WHERE documento_id=?').all(documentoId);
  const valores = Object.fromEntries(campos.map((x) => [x.campo, x.valor_extraido === null ? null : (x.campo === 'competencia' ? x.valor_extraido : Number(x.valor_extraido))]));
  if (!valores.competencia || !Number.isFinite(valores.das)) throw new Error('Confirme somente quando competência e valor do DAS estiverem identificados no documento.');
  db.transaction(() => {
    const existente = db.prepare('SELECT id FROM perfil_tributario WHERE empresa_id=? AND competencia=? ORDER BY id DESC LIMIT 1').get(empresaId, valores.competencia);
    const camposPerfil = [valores.receita_bruta, valores.receita_recebida, valores.receita_mercadorias, valores.receita_servicos, valores.receita_exportacao, valores.pis, valores.cofins];
    const origem = String(doc.tipo_documento || '').startsWith('INTEGRA_CONTADOR') ? 'pgdas_integra_contador_confirmado' : 'pgdas_azure_confirmado';
    if (existente) db.prepare(`UPDATE perfil_tributario SET receita_bruta=COALESCE(?,receita_bruta),receita_recebida=COALESCE(?,receita_recebida),receita_mercadorias=COALESCE(?,receita_mercadorias),receita_servicos=COALESCE(?,receita_servicos),receita_exportacao=COALESCE(?,receita_exportacao),pis=COALESCE(?,pis),cofins=COALESCE(?,cofins),das=?,origem=? WHERE id=?`).run(...camposPerfil, valores.das, origem, existente.id);
    else db.prepare(`INSERT INTO perfil_tributario (empresa_id,competencia,receita_bruta,receita_recebida,receita_mercadorias,receita_servicos,receita_exportacao,pis,cofins,das,origem) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(empresaId, valores.competencia, ...camposPerfil, valores.das, origem);
    db.prepare("UPDATE pgdas_documento_campos SET status_validacao='VALIDADO_USUARIO' WHERE documento_id=? AND valor_extraido IS NOT NULL").run(documentoId);
    db.prepare("UPDATE pgdas_documentos SET status_processamento='VALIDADO_USUARIO' WHERE id=?").run(documentoId);
  })();
  return listar(db, empresaId).find((x) => x.id === Number(documentoId));
}

module.exports = { CAMPOS, normalizarTexto, ingerir, listar, reprocessarCampos, confirmar };

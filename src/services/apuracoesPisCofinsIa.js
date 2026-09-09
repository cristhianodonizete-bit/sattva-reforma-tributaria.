/*
 * Ingestão auditável de apurações históricas de PIS/Cofins.
 *
 * Esta camada registra extração e validação; não calcula tributos, não altera
 * movimentos nem aciona o motor CBS. A IA só pode propor campos explicitamente
 * encontrados no documento, sempre acompanhados de localização e confiança.
 */
const crypto = require('crypto');
const supabase = require('./supabase');

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

function valorNumericoDoTexto(valor) {
  const textoBruto = texto(valor).replace(/R\$|\s/g, '').replace(/[^0-9,.-]/g, '');
  if (!textoBruto) return null;
  const normalizado = textoBruto.includes(',')
    ? textoBruto.replace(/\./g, '').replace(',', '.')
    : textoBruto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function competenciaDoTexto(valor) {
  const encontrada = texto(valor).match(/(\d{2})\/(\d{4})|(\d{4})-(\d{2})/);
  if (!encontrada) return null;
  return encontrada[1] ? `${encontrada[2]}-${encontrada[1]}` : `${encontrada[3]}-${encontrada[4]}`;
}

function textoDoRelatorio(textoDocumento) {
  const bruto = String(textoDocumento || '');
  // O conector Questor pode devolver o nWeb encapsulado em JSON, no campo
  // Data. Abrir esse envelope antes de procurar as seções evita que os \r\n
  // literais impeçam a distinção entre Entradas e Saídas.
  try {
    const envelope = JSON.parse(bruto);
    if (typeof envelope?.Data === 'string') return envelope.Data;
  } catch (_) { /* relatório textual direto */ }
  return bruto;
}

// Normaliza somente rótulos e valores literalmente presentes no texto OCR.
// Não calcula tributos, não completa ausências e deixa toda extração para revisão.
function normalizarTextoDeterministico(textoDocumento, { localizacoes = [], metodo = 'NORMALIZACAO_DETERMINISTICA' } = {}) {
  const textoLido = textoDoRelatorio(textoDocumento);
  const linhas = textoLido.split(/\r?\n/).map((linha) => linha.trim()).filter(Boolean);
  const saida = Object.fromEntries(CAMPOS.map((campo) => [campo, {
    valor_extraido: null, origem_documento: 'OCR_AZURE', pagina_ou_localizacao: null,
    rotulo_original: null, confianca: null, metodo_extracao: metodo, status_validacao: 'INDETERMINADO',
  }]));
  const regras = [
    ['competencia', /^(compet[eê]ncia|per[ií]odo(?:\s+de\s+apura[cç][aã]o)?)\s*[:\-]\s*(.+)$/i, competenciaDoTexto],
    ['regime_pis_cofins', /^(regime(?:\s+pis\/?cofins)?)\s*[:\-]\s*(.+)$/i, (v) => texto(v) || null],
    ['receita_base', /^(receita\s+(?:base|bruta|tribut[aá]vel))\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['pis_credito_utilizado', /^(pis\s+(?:cr[eé]dito\s+)?utilizado)\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['cofins_credito_utilizado', /^(cofins\s+(?:cr[eé]dito\s+)?utilizad[ao])\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['pis_credito', /^(pis\s+cr[eé]dito)\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['cofins_credito', /^(cofins\s+cr[eé]dito)\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['pis_debito', /^(pis\s+d[eé]bito)\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['cofins_debito', /^(cofins\s+d[eé]bito)\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['pis_recolhido', /^(pis\s+(?:a\s+)?recolher|pis\s+recolhido)\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['cofins_recolhida', /^(cofins\s+(?:a\s+)?recolher|cofins\s+recolhid[ao])\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['saldo_pis', /^(saldo\s+(?:de\s+)?pis)\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
    ['saldo_cofins', /^(saldo\s+(?:de\s+)?cofins)\s*[:\-]\s*(.+)$/i, valorNumericoDoTexto],
  ];
  for (const linha of linhas) {
    for (const [campo, padrao, converter] of regras) {
      if (saida[campo].valor_extraido !== null) continue;
      const encontrada = linha.match(padrao);
      if (!encontrada) continue;
      const valor = converter(encontrada[2]);
      if (valor === null || valor === '') continue;
      const local = localizacoes.find((x) => String(x.texto || '').includes(linha));
      saida[campo] = {
        valor_extraido: valor, origem_documento: 'OCR_AZURE', pagina_ou_localizacao: local?.pagina ? `p. ${local.pagina}` : null,
        rotulo_original: encontrada[1], confianca: local?.confianca ?? 0.9,
        metodo_extracao: metodo, status_validacao: 'REQUER_VALIDACAO',
      };
    }
  }

  // Relatórios de totalização por produto (como os emitidos por ERPs) não
  // repetem rótulos no formato "PIS débito: R$ ...". Eles exibem uma tabela
  // consolidada por CST. A leitura abaixo reconhece somente o bloco de total
  // explicitamente identificado, sem inferir crédito ou pagamento.
  const preencherSeAusente = (campo, valor, rotulo) => {
    if (saida[campo].valor_extraido !== null || valor === null || valor === undefined) return;
    saida[campo] = {
      valor_extraido: valor, origem_documento: 'OCR_AZURE', pagina_ou_localizacao: null,
      rotulo_original: rotulo, confianca: 0.9, metodo_extracao: metodo, status_validacao: 'REQUER_VALIDACAO',
    };
  };
  const numerosDoBloco = (bloco) => (String(bloco || '').match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || [])
    .map(valorNumericoDoTexto).filter((v) => v !== null);
  // Alguns layouts escrevem o intervalo completo (01/06/2026 a
  // 30/06/2026), outros apenas 06/2026. Ambos identificam a competência.
  const periodo = textoLido.match(/per[ií]odo\s*:\s*(?:\d{2}\/)?(\d{2}\/\d{4})/i);
  if (periodo) preencherSeAusente('competencia', competenciaDoTexto(periodo[1]), 'Período');
  if (/contribui[cç][aã]o\s+cumulativa/i.test(textoLido)) {
    preencherSeAusente('regime_pis_cofins', 'CUMULATIVO', 'Contribuição Cumulativa Apurada');
  }
  const textoCompleto = textoLido;
  // Em relatórios por produto, Entradas e Saídas possuem totalizações com os
  // mesmos rótulos. Para apuração de PIS/Cofins da receita, somente o bloco
  // posterior a "Saídas" é elegível; retorno, comodato e demais entradas
  // jamais podem preencher receita-base ou débito.
  const marcadorSaidas = /(?:^|\n)\s*-\s*sa[ií]das\b/i.exec(textoCompleto);
  const textoSaidas = marcadorSaidas ? textoCompleto.slice(marcadorSaidas.index) : textoCompleto;
  const blocoPis = textoSaidas.match(/c[oó]digo\s+da\s+situa[cç][aã]o\s+tribut[aá]ria\s+pis[\s\S]*?(?=c[oó]digo\s+da\s+situa[cç][aã]o\s+tribut[aá]ria\s+cofins|totaliza[cç][aã]o\s+por\s+tipo)/i)?.[0];
  const blocoCofins = textoSaidas.match(/c[oó]digo\s+da\s+situa[cç][aã]o\s+tribut[aá]ria\s+cofins[\s\S]*?(?=totaliza[cç][aã]o\s+por\s+tipo|$)/i)?.[0];
  const valoresPis = numerosDoBloco(blocoPis);
  const valoresCofins = numerosDoBloco(blocoCofins);
  // A última tríade da totalização é receita, base de cálculo e contribuição.
  if (valoresPis.length >= 3) {
    preencherSeAusente('receita_base', valoresPis.at(-2), 'Totalização por CST PIS');
    preencherSeAusente('pis_debito', valoresPis.at(-1), 'Totalização por CST PIS');
  }
  if (valoresCofins.length >= 3) {
    preencherSeAusente('receita_base', valoresCofins.at(-2), 'Totalização por CST COFINS');
    preencherSeAusente('cofins_debito', valoresCofins.at(-1), 'Totalização por CST COFINS');
  }
  return saida;
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
  const apuracoes = db.prepare(`SELECT a.*, d.nome_original,d.tipo_documento,d.hash_sha256,d.versao_modelo_extracao,d.data_processamento AS importado_em
    FROM pis_cofins_apuracoes_historicas a JOIN pis_cofins_apuracao_documentos d ON d.id=a.documento_id
    WHERE a.empresa_id=? ORDER BY a.competencia DESC,a.id DESC`).all(empresaId);
  const campos = db.prepare(`SELECT c.* FROM pis_cofins_apuracao_campos c JOIN pis_cofins_apuracoes_historicas a ON a.id=c.apuracao_id
    WHERE a.empresa_id=? ORDER BY c.apuracao_id,c.id`).all(empresaId);
  const porApuracao = new Map();
  for (const campo of campos) (porApuracao.get(campo.apuracao_id) || porApuracao.set(campo.apuracao_id, []).get(campo.apuracao_id)).push(campo);
  return apuracoes.map((a) => ({ ...a, campos_extraidos: porApuracao.get(a.id) || [], campos_pendentes: (porApuracao.get(a.id) || []).filter((x) => x.status_validacao !== 'VALIDADO_AUTOMATICAMENTE').map((x) => x.campo) }));
}

// Releitura do mesmo original, sem permitir duplicação do documento nem
// inventar novos valores. Serve quando o reconhecimento determinístico ganha
// suporte para um layout já preservado no histórico.
function reprocessar(db, empresaId, apuracaoId, camposBrutos, versaoModeloExtracao) {
  validarEmpresa(db, empresaId);
  const apuracao = db.prepare(`SELECT a.*, d.id AS documento_id FROM pis_cofins_apuracoes_historicas a
    JOIN pis_cofins_apuracao_documentos d ON d.id=a.documento_id WHERE a.id=? AND a.empresa_id=?`).get(apuracaoId, empresaId);
  if (!apuracao) throw new Error('Apuração não encontrada para esta empresa.');
  const campos = CAMPOS.map((campo) => extracaoCampo(campo, camposBrutos?.[campo]));
  // Uma nova regra de leitura não pode fazer uma competência antes conhecida
  // desaparecer caso o texto do ERP venha sem o período em seu layout.
  const campoCompetencia = campos.find((x) => x.campo === 'competencia');
  if (campoCompetencia && !campoCompetencia.valor_extraido && apuracao.competencia) {
    campoCompetencia.valor_extraido = apuracao.competencia;
    campoCompetencia.origem_documento = 'COMPETENCIA_PRESERVADA_DO_DOCUMENTO';
    campoCompetencia.rotulo_original = 'Competência preservada na releitura';
    campoCompetencia.confianca = 1;
    campoCompetencia.status_validacao = 'VALIDADO_AUTOMATICAMENTE';
  }
  const valores = Object.fromEntries(campos.map((x) => [x.campo, x.valor_extraido]));
  const divergencias = validarConsistencia(campos);
  db.transaction(() => {
    db.prepare(`UPDATE pis_cofins_apuracoes_historicas SET competencia=?,regime_pis_cofins=?,receita_base=?,pis_debito=?,cofins_debito=?,pis_credito=?,cofins_credito=?,pis_credito_utilizado=?,cofins_credito_utilizado=?,saldo_pis=?,saldo_cofins=?,pis_recolhido=?,cofins_recolhida=?,observacoes=?,status_validacao=?,divergencias=? WHERE id=?`).run(
      valores.competencia, valores.regime_pis_cofins, valores.receita_base, valores.pis_debito, valores.cofins_debito,
      valores.pis_credito, valores.cofins_credito, valores.pis_credito_utilizado, valores.cofins_credito_utilizado,
      valores.saldo_pis, valores.saldo_cofins, valores.pis_recolhido, valores.cofins_recolhida, valores.observacoes,
      divergencias.length ? 'REQUER_VALIDACAO' : 'VALIDADO_AUTOMATICAMENTE', JSON.stringify(divergencias), apuracaoId);
    db.prepare('DELETE FROM pis_cofins_apuracao_campos WHERE apuracao_id=?').run(apuracaoId);
    const inserirCampo = db.prepare(`INSERT INTO pis_cofins_apuracao_campos
      (apuracao_id,campo,valor_extraido,origem_documento,pagina_ou_localizacao,rotulo_original,confianca,metodo_extracao,status_validacao)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const campo of campos) inserirCampo.run(apuracaoId, campo.campo, campo.valor_extraido === null ? null : String(campo.valor_extraido), campo.origem_documento, campo.pagina_ou_localizacao, campo.rotulo_original, campo.confianca, campo.metodo_extracao, campo.status_validacao);
    db.prepare('UPDATE pis_cofins_apuracao_documentos SET competencia_detectada=?,data_processamento=?,versao_modelo_extracao=?,status_processamento=? WHERE id=?').run(
      valores.competencia, new Date().toISOString(), versaoModeloExtracao || 'REPROCESSAMENTO_DETERMINISTICO_V1', divergencias.length ? 'REQUER_VALIDACAO' : 'PROCESSADO', apuracao.documento_id);
  })();
  return listarParaRevisao(db, empresaId).find((x) => Number(x.id) === Number(apuracaoId));
}

function importarRelatorioQuestor(db, empresaId, textoRelatorio, { competenciaSolicitada = null } = {}) {
  const campos = normalizarTextoDeterministico(textoRelatorio, { metodo:'QUESTOR_NWEB_RELATORIO_V1' });
  // O relatório de totalização por produto do Questor não exibe a competência
  // em todos os layouts. Cada solicitação é feita para somente um mês; nesse
  // caso a competência enviada ao nWeb é uma referência auditável, e não uma
  // estimativa extraída do valor retornado.
  if (!campos.competencia?.valor_extraido && competencia(competenciaSolicitada)) {
    campos.competencia = {
      valor_extraido: competenciaSolicitada, origem_documento:'SOLICITACAO_QUESTOR', pagina_ou_localizacao:null,
      rotulo_original:'Competência solicitada ao nWeb', confianca:1, metodo_extracao:'QUESTOR_NWEB_PARAMETRO_V1',
      status_validacao:'VALIDADO_AUTOMATICAMENTE',
    };
  }
  const competenciaExtraida = campos.competencia?.valor_extraido;
  if (!competenciaExtraida) throw new Error('O relatório Questor não informou uma competência identificável.');
  const existente = db.prepare('SELECT id FROM pis_cofins_apuracoes_historicas WHERE empresa_id=? AND competencia=? LIMIT 1').get(empresaId, competenciaExtraida);
  if (existente) return { ignorado:true, motivo:'Competência já importada; nenhum valor foi sobrescrito.', competencia:competenciaExtraida };
  const hash = crypto.createHash('sha256').update(Buffer.from(String(textoRelatorio || ''), 'utf8')).digest('hex');
  const documentoIgual = db.prepare(`SELECT a.competencia FROM pis_cofins_apuracao_documentos d
    JOIN pis_cofins_apuracoes_historicas a ON a.documento_id=d.id
    WHERE d.empresa_id=? AND d.hash_sha256=? LIMIT 1`).get(empresaId, hash);
  if (documentoIgual) return {
    ignorado:true, competencia:competenciaExtraida,
    motivo:`O Questor retornou o mesmo relatório já usado na competência ${documentoIgual.competencia}. Nenhum valor foi duplicado; consulte os parâmetros do relatório para confirmar os filtros de período.`,
  };
  return { ignorado:false, ...ingestao(db, empresaId, {
    nome_original:`Questor — Totais PIS e COFINS por Produto — ${competenciaExtraida}.txt`, tipo_documento:'RELATORIO_ERP', mime_type:'text/plain',
    conteudo_original:Buffer.from(String(textoRelatorio || ''),'utf8'), versao_modelo_extracao:'QUESTOR_NWEB_RELATORIO_V1',
  }, campos) };
}

async function publicarCompartilhado(db, empresaId) {
  if (!supabase.configurado()) return { ativo:false };
  const local = db.prepare('SELECT cnpj FROM empresas WHERE id=?').get(empresaId);
  const cnpj = String(local?.cnpj || '').replace(/\D/g, '');
  const { data: empresas, error: empresaErro } = await supabase.admin().from('empresas').select('id').or(cnpj ? `origem_local_id.eq.${empresaId},cnpj.eq.${cnpj}` : `origem_local_id.eq.${empresaId}`).limit(2);
  if (empresaErro || !empresas?.length) throw new Error(`Não foi possível localizar a empresa compartilhada para a apuração: ${empresaErro?.message || 'empresa ausente'}`);
  const remoto = supabase.admin(), empresaRemota = empresas[0].id;
  const itens = listarParaRevisao(db, empresaId);
  for (const item of itens) {
    const docLocal = db.prepare('SELECT * FROM pis_cofins_apuracao_documentos WHERE id=?').get(item.documento_id);
    const documento = { empresa_id:empresaRemota, nome_original:docLocal.nome_original, tipo_documento:docLocal.tipo_documento, mime_type:docLocal.mime_type || null, conteudo_original:`\\x${Buffer.from(docLocal.conteudo_original).toString('hex')}`, hash_sha256:docLocal.hash_sha256, competencia_detectada:docLocal.competencia_detectada || null, data_processamento:docLocal.data_processamento, versao_modelo_extracao:docLocal.versao_modelo_extracao, status_processamento:docLocal.status_processamento };
    let { data: doc, error } = await remoto.from('pis_cofins_apuracao_documentos').upsert(documento, { onConflict:'empresa_id,hash_sha256' }).select('id').single(); if (error) throw new Error(error.message);
    const apuracao = { empresa_id:empresaRemota, documento_id:doc.id, competencia:item.competencia || null, regime_pis_cofins:item.regime_pis_cofins || null, receita_base:item.receita_base, pis_debito:item.pis_debito, cofins_debito:item.cofins_debito, pis_credito:item.pis_credito, cofins_credito:item.cofins_credito, pis_credito_utilizado:item.pis_credito_utilizado, cofins_credito_utilizado:item.cofins_credito_utilizado, saldo_pis:item.saldo_pis, saldo_cofins:item.saldo_cofins, pis_recolhido:item.pis_recolhido, cofins_recolhida:item.cofins_recolhida, observacoes:item.observacoes || null, status_validacao:item.status_validacao, divergencias:item.divergencias || [] };
    let r = await remoto.from('pis_cofins_apuracoes_historicas').upsert(apuracao, { onConflict:'documento_id' }).select('id').single(); if (r.error) throw new Error(r.error.message);
    await remoto.from('pis_cofins_apuracao_campos').delete().eq('apuracao_id', r.data.id);
    const campos = (item.campos_extraidos || []).map((c) => ({ apuracao_id:r.data.id, campo:c.campo, valor_extraido:c.valor_extraido == null ? null : String(c.valor_extraido), origem_documento:c.origem_documento, pagina_ou_localizacao:c.pagina_ou_localizacao, rotulo_original:c.rotulo_original, confianca:c.confianca, metodo_extracao:c.metodo_extracao, status_validacao:c.status_validacao }));
    if (campos.length) { const { error: ce } = await remoto.from('pis_cofins_apuracao_campos').insert(campos); if (ce) throw new Error(ce.message); }
  }
  return { ativo:true, apuracoes:itens.length };
}

function excluir(db, empresaId, apuracaoId) {
  validarEmpresa(db, empresaId);
  const apuracao = db.prepare(`SELECT a.id,a.documento_id,d.nome_original,d.hash_sha256 FROM pis_cofins_apuracoes_historicas a
    JOIN pis_cofins_apuracao_documentos d ON d.id=a.documento_id WHERE a.id=? AND a.empresa_id=?`).get(apuracaoId, empresaId);
  if (!apuracao) throw new Error('Apuração não encontrada para esta empresa.');
  db.transaction(() => {
    db.prepare('DELETE FROM pis_cofins_apuracao_campos WHERE apuracao_id=?').run(apuracao.id);
    db.prepare('DELETE FROM pis_cofins_apuracoes_historicas WHERE id=? AND empresa_id=?').run(apuracao.id, empresaId);
    db.prepare('DELETE FROM pis_cofins_apuracao_documentos WHERE id=?').run(apuracao.documento_id);
  })();
  return { excluida:true, nome_original:apuracao.nome_original, hash_sha256:apuracao.hash_sha256 };
}

async function excluirCompartilhado(db, empresaId, apuracaoId) {
  const apuracao = db.prepare(`SELECT a.documento_id,d.hash_sha256 FROM pis_cofins_apuracoes_historicas a
    JOIN pis_cofins_apuracao_documentos d ON d.id=a.documento_id WHERE a.id=? AND a.empresa_id=?`).get(apuracaoId, empresaId);
  if (!apuracao) throw new Error('Apuração não encontrada para esta empresa.');
  if (supabase.configurado()) {
    const local = db.prepare('SELECT cnpj FROM empresas WHERE id=?').get(empresaId);
    const cnpj = String(local?.cnpj || '').replace(/\D/g, '');
    const remoto = supabase.admin();
    const { data: empresas, error } = await remoto.from('empresas').select('id').or(cnpj ? `origem_local_id.eq.${empresaId},cnpj.eq.${cnpj}` : `origem_local_id.eq.${empresaId}`).limit(2);
    if (error || !empresas?.length) throw new Error(`Não foi possível localizar a empresa compartilhada para excluir a apuração: ${error?.message || 'empresa ausente'}`);
    const { data: documento, error: erroDocumento } = await remoto.from('pis_cofins_apuracao_documentos').select('id').eq('empresa_id', empresas[0].id).eq('hash_sha256', apuracao.hash_sha256).maybeSingle();
    if (erroDocumento) throw new Error(erroDocumento.message);
    if (documento?.id) {
      const { data: aps, error: erroAps } = await remoto.from('pis_cofins_apuracoes_historicas').select('id').eq('documento_id', documento.id);
      if (erroAps) throw new Error(erroAps.message);
      const ids = (aps || []).map((x) => x.id);
      if (ids.length) { const { error: erroCampos } = await remoto.from('pis_cofins_apuracao_campos').delete().in('apuracao_id', ids); if (erroCampos) throw new Error(erroCampos.message); }
      const { error: erroApuracoes } = await remoto.from('pis_cofins_apuracoes_historicas').delete().eq('documento_id', documento.id); if (erroApuracoes) throw new Error(erroApuracoes.message);
      const { error: erroExcluirDocumento } = await remoto.from('pis_cofins_apuracao_documentos').delete().eq('id', documento.id); if (erroExcluirDocumento) throw new Error(erroExcluirDocumento.message);
    }
  }
  return excluir(db, empresaId, apuracaoId);
}

async function restaurarCompartilhado(db, empresaId) {
  if (!supabase.configurado()) return { ativo:false };
  const local = db.prepare('SELECT cnpj FROM empresas WHERE id=?').get(empresaId), cnpj = String(local?.cnpj || '').replace(/\D/g, '');
  const { data: empresas } = await supabase.admin().from('empresas').select('id').or(cnpj ? `origem_local_id.eq.${empresaId},cnpj.eq.${cnpj}` : `origem_local_id.eq.${empresaId}`).limit(1);
  if (!empresas?.[0]) return { ativo:true, apuracoes:0 };
  const remoto = supabase.admin(), remotoEmpresa = empresas[0].id;
  const { data: docs, error } = await remoto.from('pis_cofins_apuracao_documentos').select('*').eq('empresa_id', remotoEmpresa);
  if (error) throw new Error(error.message); if (!docs?.length) return { ativo:true, apuracoes:0 };
  // Só repõe o cache se ele estiver vazio; nunca substitui trabalho ainda vivo.
  if (db.prepare('SELECT 1 FROM pis_cofins_apuracoes_historicas WHERE empresa_id=? LIMIT 1').get(empresaId)) return { ativo:true, apuracoes:0, cache_preservado:true };
  const ids = docs.map((d) => d.id), { data: aps } = await remoto.from('pis_cofins_apuracoes_historicas').select('*').in('documento_id', ids), apIds = (aps || []).map((a) => a.id), { data: campos } = apIds.length ? await remoto.from('pis_cofins_apuracao_campos').select('*').in('apuracao_id', apIds) : { data:[] };
  const porDoc = new Map(), porAp = new Map();
  db.transaction(() => {
    for (const d of docs) { const r=db.prepare(`INSERT INTO pis_cofins_apuracao_documentos (empresa_id,nome_original,tipo_documento,mime_type,conteudo_original,hash_sha256,competencia_detectada,data_processamento,versao_modelo_extracao,status_processamento) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(empresaId,d.nome_original,d.tipo_documento,d.mime_type,d.conteudo_original ? Buffer.from(String(d.conteudo_original).replace(/^\\x/,''),'hex') : Buffer.alloc(0),d.hash_sha256,d.competencia_detectada,d.data_processamento,d.versao_modelo_extracao,d.status_processamento); porDoc.set(d.id,r.lastInsertRowid); }
    for (const a of (aps||[])) { const r=db.prepare(`INSERT INTO pis_cofins_apuracoes_historicas (empresa_id,documento_id,competencia,regime_pis_cofins,receita_base,pis_debito,cofins_debito,pis_credito,cofins_credito,pis_credito_utilizado,cofins_credito_utilizado,saldo_pis,saldo_cofins,pis_recolhido,cofins_recolhida,observacoes,status_validacao,divergencias) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(empresaId,porDoc.get(a.documento_id),a.competencia,a.regime_pis_cofins,a.receita_base,a.pis_debito,a.cofins_debito,a.pis_credito,a.cofins_credito,a.pis_credito_utilizado,a.cofins_credito_utilizado,a.saldo_pis,a.saldo_cofins,a.pis_recolhido,a.cofins_recolhida,a.observacoes,a.status_validacao,JSON.stringify(a.divergencias||[])); porAp.set(a.id,r.lastInsertRowid); }
    for (const c of (campos||[])) db.prepare(`INSERT INTO pis_cofins_apuracao_campos (apuracao_id,campo,valor_extraido,origem_documento,pagina_ou_localizacao,rotulo_original,confianca,metodo_extracao,status_validacao) VALUES (?,?,?,?,?,?,?,?,?)`).run(porAp.get(c.apuracao_id),c.campo,c.valor_extraido,c.origem_documento,c.pagina_ou_localizacao,c.rotulo_original,c.confianca,c.metodo_extracao,c.status_validacao);
  })(); return { ativo:true, apuracoes:(aps||[]).length };
}

// A confirmação não recalcula nem altera valores extraídos. Ela apenas registra
// a revisão humana de campos presentes e preserva NULL/INDETERMINADO.
function confirmarRevisao(db, empresaId, apuracaoId) {
  validarEmpresa(db, empresaId);
  const apuracao = db.prepare('SELECT * FROM pis_cofins_apuracoes_historicas WHERE id=? AND empresa_id=?').get(apuracaoId, empresaId);
  if (!apuracao) throw new Error('Apuração não encontrada para esta empresa.');
  db.transaction(() => {
    db.prepare("UPDATE pis_cofins_apuracao_campos SET status_validacao='VALIDADO_USUARIO' WHERE apuracao_id=? AND valor_extraido IS NOT NULL")
      .run(apuracaoId);
    db.prepare("UPDATE pis_cofins_apuracoes_historicas SET status_validacao='VALIDADO_USUARIO' WHERE id=? AND empresa_id=?")
      .run(apuracaoId, empresaId);
    db.prepare("UPDATE pis_cofins_apuracao_documentos SET status_processamento='VALIDADO_USUARIO' WHERE id=?")
      .run(apuracao.documento_id);
  })();
  return listarParaRevisao(db, empresaId).find((x) => Number(x.id) === Number(apuracaoId));
}

function promptExtracao(textoDocumento) {
  return `Extraia apenas valores expressos no documento de apuração PIS/Cofins. Não calcule, não infira e não substitua ausência por zero. Retorne JSON com a chave campos e, para cada campo abaixo, valor_extraido, origem_documento, pagina_ou_localizacao, rotulo_original, confianca (0 a 1), metodo_extracao e status_validacao. Campos: ${CAMPOS.join(', ')}. Se não existir, valor_extraido deve ser null e status_validacao INDETERMINADO. Documento:\n${String(textoDocumento).slice(0, 70000)}`;
}

module.exports = { CAMPOS, STATUS, ingestao, listarParaRevisao, reprocessar, excluir, excluirCompartilhado, importarRelatorioQuestor, confirmarRevisao, publicarCompartilhado, restaurarCompartilhado, promptExtracao, validarConsistencia, normalizarTextoDeterministico };

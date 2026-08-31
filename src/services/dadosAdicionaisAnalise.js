/*
 * Dados complementares para diagnóstico. Esta camada guarda fatos e
 * premissas informadas; ela não calcula nem alimenta o motor fiscal.
 */
const crypto = require('crypto');

const STATUS_VALIDACAO = new Set(['PENDENTE', 'VALIDADO', 'POSSIVEL_DUPLICIDADE', 'REJEITADO']);

function texto(valor) {
  return String(valor ?? '').trim();
}

function normalizarTexto(valor) {
  return texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

function competenciaValida(valor) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(texto(valor));
}

function numeroObrigatorio(valor, campo, { permiteZero = true } = {}) {
  if (valor === '' || valor === null || valor === undefined || !Number.isFinite(Number(valor))) throw new Error(`${campo} obrigatório.`);
  const n = Number(valor);
  if (n < 0 || (!permiteZero && n === 0)) throw new Error(`${campo} inválido.`);
  return n;
}

function validarEmpresa(db, empresaId) {
  if (!db.prepare('SELECT 1 FROM empresas WHERE id=?').get(empresaId)) throw new Error('Empresa não encontrada.');
}

function status(valor, padrao = 'PENDENTE') {
  const resultado = texto(valor || padrao).toUpperCase();
  if (!STATUS_VALIDACAO.has(resultado)) throw new Error('Status de validação inválido.');
  return resultado;
}

function salvarFolha(db, empresaId, dados) {
  validarEmpresa(db, empresaId);
  const competencia = texto(dados.competencia);
  if (!competenciaValida(competencia)) throw new Error('Competência deve estar no formato AAAA-MM.');
  const existente = db.prepare('SELECT id FROM folhas_pagamento_competencias WHERE empresa_id=? AND competencia=?').get(empresaId, competencia);
  if (existente) throw new Error('Já existe folha informada para esta empresa e competência.');
  const valorFolha = numeroObrigatorio(dados.valor_folha, 'Valor da folha');
  const proLabore = dados.pro_labore === '' || dados.pro_labore === null || dados.pro_labore === undefined ? null : numeroObrigatorio(dados.pro_labore, 'Pró-labore');
  const r = db.prepare(`INSERT INTO folhas_pagamento_competencias
    (empresa_id,competencia,valor_folha,pro_labore,origem,referencia_arquivo,status_validacao)
    VALUES (?,?,?,?,?,?,?)`).run(empresaId, competencia, valorFolha, proLabore, texto(dados.origem || 'MANUAL'),
    texto(dados.referencia_arquivo) || null, status(dados.status_validacao));
  return { id: r.lastInsertRowid };
}

function salvarMargem(db, empresaId, dados) {
  validarEmpresa(db, empresaId);
  const inicio = texto(dados.periodo_inicio), fim = texto(dados.periodo_fim);
  if (!competenciaValida(inicio) || !competenciaValida(fim) || inicio > fim) throw new Error('Período da margem inválido.');
  const margem = numeroObrigatorio(dados.margem_operacional_percentual, 'Margem operacional');
  if (margem > 100) throw new Error('Margem operacional deve ser informada em percentual entre 0 e 100.');
  const existente = db.prepare('SELECT id FROM margens_operacionais_premissas WHERE empresa_id=? AND periodo_inicio=? AND periodo_fim=?').get(empresaId, inicio, fim);
  if (existente) throw new Error('Já existe margem operacional para este período.');
  const r = db.prepare(`INSERT INTO margens_operacionais_premissas
    (empresa_id,periodo_inicio,periodo_fim,margem_operacional_percentual,origem,natureza,status_validacao)
    VALUES (?,?,?,?,?,'PREMISSA_INFORMADA',?)`).run(empresaId, inicio, fim, margem, texto(dados.origem || 'MANUAL'), status(dados.status_validacao));
  return { id: r.lastInsertRowid };
}

function candidatosDocumento(db, empresaId, competencia, valor) {
  const linhas = db.prepare(`SELECT id,descricao,documento,chave FROM movimentos
    WHERE empresa_id=? AND competencia=? AND tipo='cliente' AND ABS(COALESCE(valor,0)-?) < 0.005`).all(empresaId, competencia, valor);
  return linhas;
}

function salvarReceitaSemDfe(db, empresaId, dados) {
  validarEmpresa(db, empresaId);
  const competencia = texto(dados.competencia), tipoReceita = texto(dados.tipo_receita), descricao = texto(dados.descricao);
  if (!competenciaValida(competencia)) throw new Error('Competência deve estar no formato AAAA-MM.');
  if (!tipoReceita || !descricao) throw new Error('Tipo e descrição da receita são obrigatórios.');
  const valor = numeroObrigatorio(dados.valor, 'Valor da receita');
  const chave = crypto.createHash('sha256').update([empresaId, competencia, normalizarTexto(tipoReceita), normalizarTexto(descricao), valor.toFixed(2)].join('|')).digest('hex');
  if (db.prepare('SELECT id FROM receitas_sem_dfe WHERE empresa_id=? AND chave_deduplicacao=?').get(empresaId, chave)) throw new Error('Receita complementar duplicada para esta empresa.');

  const candidatos = candidatosDocumento(db, empresaId, competencia, valor);
  const exato = candidatos.find((x) => normalizarTexto(x.descricao) === normalizarTexto(descricao));
  if (exato) throw new Error('Receita já capturada em documento fiscal; não foi criada uma entrada complementar.');
  const statusValidacao = candidatos.length ? 'POSSIVEL_DUPLICIDADE' : status(dados.status_validacao);
  const r = db.prepare(`INSERT INTO receitas_sem_dfe
    (empresa_id,competencia,tipo_receita,descricao,valor,origem,evidencia,status_validacao,chave_deduplicacao)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(empresaId, competencia, tipoReceita, descricao, valor, texto(dados.origem || 'MANUAL'),
    texto(dados.evidencia) || null, statusValidacao, chave);
  return { id: r.lastInsertRowid, status_validacao: statusValidacao, possivel_duplicidade: candidatos.length > 0 };
}

function listar(db, empresaId) {
  validarEmpresa(db, empresaId);
  return {
    folhas: db.prepare('SELECT * FROM folhas_pagamento_competencias WHERE empresa_id=? ORDER BY competencia DESC').all(empresaId),
    margens: db.prepare('SELECT * FROM margens_operacionais_premissas WHERE empresa_id=? ORDER BY periodo_inicio DESC, periodo_fim DESC').all(empresaId),
    receitas_sem_dfe: db.prepare('SELECT * FROM receitas_sem_dfe WHERE empresa_id=? ORDER BY competencia DESC, id DESC').all(empresaId),
  };
}

module.exports = { salvarFolha, salvarMargem, salvarReceitaSemDfe, listar, STATUS_VALIDACAO };

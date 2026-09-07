/**
 * Referências fiscais oficiais
 *
 * Camada de identificação, fora do motor. Não importa nem promove regras
 * fiscais: preserva a fonte e permite completar NCM/NBS/LC116 sem alterar a
 * base operacional já homologada.
 */
const db = require('../db');

const somenteDigitos = (valor) => String(valor == null ? '' : valor).replace(/\D/g, '');
const normalizarNcm = (valor) => somenteDigitos(valor).padStart(8, '0').slice(-8);
const normalizarNbs = (valor) => somenteDigitos(valor).padStart(9, '0').slice(-9);
const normalizarLc116 = (valor) => somenteDigitos(valor).padStart(4, '0').slice(-4);

function normalizarCodigo(dominio, codigo) {
  if (dominio === 'NCM') return normalizarNcm(codigo);
  if (dominio === 'NBS') return normalizarNbs(codigo);
  if (dominio === 'LC116') return normalizarLc116(codigo);
  throw new Error(`Domínio oficial inválido: ${dominio}`);
}

function validarReferencia(referencia) {
  const dominio = String(referencia?.dominio || '').toUpperCase();
  const codigo = normalizarCodigo(dominio, referencia?.codigo);
  if (!codigo || /^0+$/.test(codigo)) throw new Error(`Código ${dominio} inválido`);
  const fonte = String(referencia?.fonte || '').trim();
  if (!fonte) throw new Error('Fonte oficial é obrigatória');
  return {
    dominio, codigo,
    descricao: String(referencia?.descricao || '').trim(),
    vigencia_inicio: String(referencia?.vigencia_inicio || '').trim(),
    vigencia_fim: referencia?.vigencia_fim ? String(referencia.vigencia_fim).trim() : null,
    situacao: String(referencia?.situacao || 'VIGENTE').toUpperCase(),
    fonte, versao_fonte: String(referencia?.versao_fonte || '').trim(),
    hash_origem: String(referencia?.hash_origem || '').trim(),
    dados_origem: JSON.stringify(referencia?.dados_origem || {}),
  };
}

function registrarReferencia(referencia) {
  const r = validarReferencia(referencia);
  const existente = db.prepare(`SELECT id FROM referencias_fiscais_oficiais
    WHERE dominio=? AND codigo=? AND vigencia_inicio=? AND fonte=? AND versao_fonte=?`).get(
    r.dominio, r.codigo, r.vigencia_inicio, r.fonte, r.versao_fonte);
  if (existente) return { id: existente.id, criado: false, ...r };
  const out = db.prepare(`INSERT INTO referencias_fiscais_oficiais
    (dominio,codigo,descricao,vigencia_inicio,vigencia_fim,situacao,fonte,versao_fonte,hash_origem,dados_origem)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    r.dominio, r.codigo, r.descricao, r.vigencia_inicio, r.vigencia_fim, r.situacao,
    r.fonte, r.versao_fonte, r.hash_origem, r.dados_origem);
  return { id: Number(out.lastInsertRowid), criado: true, ...r };
}

function registrarRelacaoNbsLc116(relacao) {
  const nbs = registrarReferencia({ ...relacao.nbs, dominio: 'NBS' });
  const lc116 = registrarReferencia({ ...relacao.lc116, dominio: 'LC116' });
  const vigenciaInicio = String(relacao.vigencia_inicio || '').trim();
  const fonte = String(relacao.fonte || '').trim();
  if (!fonte) throw new Error('Fonte oficial da relação NBS/LC116 é obrigatória');
  const existente = db.prepare(`SELECT id FROM referencias_fiscais_relacoes
    WHERE origem_id=? AND destino_id=? AND tipo='NBS_LC116' AND vigencia_inicio=? AND fonte=?`).get(nbs.id, lc116.id, vigenciaInicio, fonte);
  if (existente) return { id: existente.id, criado: false, nbs, lc116 };
  const out = db.prepare(`INSERT INTO referencias_fiscais_relacoes
    (origem_id,destino_id,tipo,vigencia_inicio,vigencia_fim,fonte,evidencia) VALUES (?,?, 'NBS_LC116',?,?,?,?)`).run(
    nbs.id, lc116.id, vigenciaInicio, relacao.vigencia_fim || null, fonte, relacao.evidencia || null);
  return { id: Number(out.lastInsertRowid), criado: true, nbs, lc116 };
}

function consultar({ ncm, nbs, lc116, somenteVigentes = true } = {}) {
  const filtros = [], params = [];
  const ativos = somenteVigentes ? " AND situacao='VIGENTE'" : '';
  if (ncm) { filtros.push("(dominio='NCM' AND codigo=?)"); params.push(normalizarNcm(ncm)); }
  if (nbs) { filtros.push("(dominio='NBS' AND codigo=?)"); params.push(normalizarNbs(nbs)); }
  if (lc116) { filtros.push("(dominio='LC116' AND codigo=?)"); params.push(normalizarLc116(lc116)); }
  if (!filtros.length) return [];
  return db.prepare(`SELECT * FROM referencias_fiscais_oficiais WHERE (${filtros.join(' OR ')})${ativos} ORDER BY dominio,codigo,vigencia_inicio DESC`).all(...params);
}

module.exports = { normalizarNcm, normalizarNbs, normalizarLc116, registrarReferencia, registrarRelacaoNbsLc116, consultar };

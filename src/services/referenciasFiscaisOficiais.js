/**
 * Referências fiscais oficiais
 *
 * Camada de identificação, fora do motor. Não importa nem promove regras
 * fiscais: preserva a fonte e permite completar NCM/NBS/LC116 sem alterar a
 * base operacional já homologada.
 */
const db = require('../db');
const fs = require('fs');
const crypto = require('crypto');

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

function sha256(conteudo) { return crypto.createHash('sha256').update(conteudo).digest('hex'); }

function referenciasNcmDoArquivo(arquivo) {
  const bruto = fs.readFileSync(arquivo);
  const json = JSON.parse(bruto.toString('utf8'));
  const data = String(json.Data_Ultima_Atualizacao_NCM || '').trim();
  const versao = [data, json.Ato].filter(Boolean).join(' | ');
  const linhas = (json.Nomenclaturas || []).filter((x) => somenteDigitos(x.Codigo).length === 8).map((x) => ({
    dominio: 'NCM', codigo: x.Codigo, descricao: x.Descricao || '',
    vigencia_inicio: x.Data_Inicio || '',
    vigencia_fim: x.Data_Fim && x.Data_Fim !== '31/12/9999' ? x.Data_Fim : null,
    situacao: x.Data_Fim === '31/12/9999' ? 'VIGENTE' : 'HISTORICO',
    fonte: 'Receita Federal / Siscomex Classif', versao_fonte: versao,
    hash_origem: sha256(bruto), dados_origem: x,
  }));
  return { linhas, versao, hash: sha256(bruto), atualizacao: data };
}

function referenciasNbsDoArquivo(arquivo) {
  const bruto = fs.readFileSync(arquivo);
  // O CSV oficial NBS 2.0 é publicado em codificação Windows-1252 e usa
  // ponto e vírgula. Mantemos a descrição como recebida, sem normalização
  // semântica ou associação a LC116.
  const texto = new TextDecoder('windows-1252').decode(bruto);
  const [cabecalho, ...corpo] = texto.split(/\r?\n/).filter(Boolean);
  if (!/NBS/i.test(cabecalho)) throw new Error('Arquivo NBS não possui cabeçalho oficial esperado');
  const linhas = corpo.map((linha) => {
    const sep = linha.indexOf(';');
    return { codigo: sep < 0 ? linha : linha.slice(0, sep), descricao: sep < 0 ? '' : linha.slice(sep + 1) };
  }).filter((x) => somenteDigitos(x.codigo).length === 9).map((x) => ({
    dominio: 'NBS', codigo: x.codigo, descricao: x.descricao,
    vigencia_inicio: '2019-01-01', situacao: 'VIGENTE',
    fonte: 'MDIC / NBS 2.0', versao_fonte: 'NBS 2.0 | arquivo publicado em 03/07/2025',
    hash_origem: sha256(bruto), dados_origem: { codigo_publicado: x.codigo },
  }));
  return { linhas, hash: sha256(bruto) };
}

function importarReferenciasOficiais({ arquivoNcm, arquivoNbs, aplicar = false } = {}) {
  const ncm = arquivoNcm ? referenciasNcmDoArquivo(arquivoNcm) : { linhas: [] };
  const nbs = arquivoNbs ? referenciasNbsDoArquivo(arquivoNbs) : { linhas: [] };
  const resumo = { ncm_lidos: ncm.linhas.length, nbs_lidos: nbs.linhas.length, ncm_hash: ncm.hash || null, nbs_hash: nbs.hash || null, aplicado: Boolean(aplicar) };
  if (!aplicar) return resumo;
  const inserir = db.prepare(`INSERT OR IGNORE INTO referencias_fiscais_oficiais
    (dominio,codigo,descricao,vigencia_inicio,vigencia_fim,situacao,fonte,versao_fonte,hash_origem,dados_origem)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  let inseridos = 0;
  db.transaction(() => {
    for (const x of [...ncm.linhas, ...nbs.linhas]) {
      const r = validarReferencia(x);
      inseridos += inserir.run(r.dominio, r.codigo, r.descricao, r.vigencia_inicio, r.vigencia_fim, r.situacao,
        r.fonte, r.versao_fonte, r.hash_origem, r.dados_origem).changes;
    }
  })();
  return { ...resumo, inseridos, existentes: ncm.linhas.length + nbs.linhas.length - inseridos };
}

module.exports = {
  normalizarNcm, normalizarNbs, normalizarLc116, registrarReferencia, registrarRelacaoNbsLc116, consultar,
  referenciasNcmDoArquivo, referenciasNbsDoArquivo, importarReferenciasOficiais,
};

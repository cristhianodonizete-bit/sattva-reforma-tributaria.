/**
 * BASE DE CONHECIMENTO (RAG)
 * ---------------------------------------------------------------------------
 * Recuperação léxica BM25 sobre trechos indexados. Sem dependência externa,
 * sem serviço de embeddings, sem banco vetorial — roda na rede interna e
 * funciona offline. Para o volume típico de uma base contratual/normativa
 * (milhares de trechos), o BM25 entrega recuperação boa e explicável: dá para
 * mostrar ao cliente exatamente de onde veio cada fundamento.
 *
 * Fluxo: documento -> chunks de ~1200 caracteres com sobreposição ->
 * tokenização com remoção de acentos e palavras vazias -> índice invertido em
 * memória, reconstruído a partir do SQLite quando o processo sobe.
 */
const db = require('../db');

const VAZIAS = new Set(('a o e de da do das dos em no na nos nas um uma uns umas para por com sem sob sobre entre ao aos à às pelo pela que se ou como mais menos ja já não nao sua seu suas seus este esta isso aquele quando onde qual quais ser sera será foi sao são tem ter tem havera haverá deve devera deverá pode podera poderá art artigo inciso paragrafo parágrafo lei nº n numero número').split(' '));

const normalizar = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

function tokenizar(texto) {
  return normalizar(texto).split(/\s+/).filter((t) => t.length > 2 && !VAZIAS.has(t));
}

// --------------------------------------------------------------------------
// Índice invertido em memória
// --------------------------------------------------------------------------
let INDICE = null;

function construirIndice() {
  const trechos = db.prepare('SELECT id, documento_id, titulo, fonte, conteudo FROM conhecimento_trechos').all();
  const docs = [];
  const df = new Map();
  for (const t of trechos) {
    const tokens = tokenizar(`${t.titulo} ${t.conteudo}`);
    const tf = new Map();
    tokens.forEach((tk) => tf.set(tk, (tf.get(tk) || 0) + 1));
    for (const tk of tf.keys()) df.set(tk, (df.get(tk) || 0) + 1);
    docs.push({ ...t, tf, tamanho: tokens.length });
  }
  const media = docs.length ? docs.reduce((s, d) => s + d.tamanho, 0) / docs.length : 1;
  INDICE = { docs, df, media, total: docs.length };
  return INDICE;
}

const invalidar = () => { INDICE = null; };

/** Busca BM25. Retorna os trechos mais relevantes com a pontuação. */
function buscar(consulta, limite = 8) {
  const idx = INDICE || construirIndice();
  if (!idx.total) return [];
  const termos = [...new Set(tokenizar(consulta))];
  if (!termos.length) return [];
  const k1 = 1.5, b = 0.75;

  const pontuados = idx.docs.map((d) => {
    let score = 0;
    for (const t of termos) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = idx.df.get(t) || 0;
      const idf = Math.log(1 + (idx.total - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.tamanho / idx.media))));
    }
    return { id: d.id, documento_id: d.documento_id, titulo: d.titulo, fonte: d.fonte, conteudo: d.conteudo, score };
  }).filter((d) => d.score > 0);

  pontuados.sort((a, b2) => b2.score - a.score);
  return pontuados.slice(0, limite);
}

// --------------------------------------------------------------------------
// Ingestão
// --------------------------------------------------------------------------
function fatiar(texto, tamanho = 1200, sobreposicao = 200) {
  const limpo = String(texto || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (limpo.length <= tamanho) return limpo ? [limpo] : [];
  const pedacos = [];
  // quebra preferencialmente em parágrafo, depois em frase
  let i = 0;
  while (i < limpo.length) {
    let fim = Math.min(i + tamanho, limpo.length);
    if (fim < limpo.length) {
      const janela = limpo.slice(i, fim);
      const corteP = janela.lastIndexOf('\n\n');
      const corteF = janela.lastIndexOf('. ');
      const corte = corteP > tamanho * 0.5 ? corteP : (corteF > tamanho * 0.5 ? corteF + 1 : -1);
      if (corte > 0) fim = i + corte;
    }
    const p = limpo.slice(i, fim).trim();
    if (p) pedacos.push(p);
    i = fim - (fim < limpo.length ? sobreposicao : 0);
    if (i < 0) i = 0;
  }
  return pedacos;
}

/** Grava um documento e seus trechos na base. */
function indexar({ titulo, fonte, categoria, conteudo, arquivo, empresa_id }) {
  const doc = db.prepare(`INSERT INTO conhecimento_documentos (titulo, fonte, categoria, arquivo, empresa_id, caracteres)
    VALUES (?,?,?,?,?,?)`).run(titulo, fonte || '', categoria || 'geral', arquivo || '', empresa_id || null, String(conteudo || '').length);
  const pedacos = fatiar(conteudo);
  const ins = db.prepare('INSERT INTO conhecimento_trechos (documento_id, titulo, fonte, conteudo, ordem) VALUES (?,?,?,?,?)');
  db.transaction(() => pedacos.forEach((p, i) => ins.run(doc.lastInsertRowid, titulo, fonte || '', p, i)))();
  db.prepare('UPDATE conhecimento_documentos SET trechos = ? WHERE id = ?').run(pedacos.length, doc.lastInsertRowid);
  invalidar();
  return { id: doc.lastInsertRowid, trechos: pedacos.length };
}

function remover(documentoId) {
  db.prepare('DELETE FROM conhecimento_trechos WHERE documento_id = ?').run(documentoId);
  db.prepare('DELETE FROM conhecimento_documentos WHERE id = ?').run(documentoId);
  invalidar();
}

function listar() {
  return db.prepare(`SELECT * FROM conhecimento_documentos ORDER BY categoria, titulo`).all();
}

function estatisticas() {
  const d = db.prepare('SELECT COUNT(*) c FROM conhecimento_documentos').get().c;
  const t = db.prepare('SELECT COUNT(*) c FROM conhecimento_trechos').get().c;
  return { documentos: d, trechos: t };
}

/** Monta o contexto textual que vai para o modelo, com as fontes numeradas. */
function montarContexto(consultas, limitePorConsulta = 5, maxTrechos = 14) {
  const vistos = new Map();
  for (const c of [].concat(consultas)) {
    for (const t of buscar(c, limitePorConsulta)) {
      if (!vistos.has(t.id)) vistos.set(t.id, t);
    }
  }
  const trechos = [...vistos.values()].sort((a, b) => b.score - a.score).slice(0, maxTrechos);
  const texto = trechos.map((t, i) => `[F${i + 1}] ${t.titulo}${t.fonte ? ` — ${t.fonte}` : ''}\n${t.conteudo}`).join('\n\n---\n\n');
  return { texto, trechos: trechos.map((t, i) => ({ marcador: `F${i + 1}`, id: t.id, titulo: t.titulo, fonte: t.fonte, score: Math.round(t.score * 100) / 100 })) };
}

module.exports = { buscar, indexar, remover, listar, estatisticas, montarContexto, fatiar, invalidar, construirIndice };

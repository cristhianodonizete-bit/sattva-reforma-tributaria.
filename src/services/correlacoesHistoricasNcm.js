const fs = require('fs');
const dbPadrao = require('../db');
const { normalizarNcm } = require('./referenciasFiscaisOficiais');

function validar(linha) {
  const origem = normalizarNcm(linha?.codigo_origem);
  const destino = normalizarNcm(linha?.codigo_destino);
  const tipo = String(linha?.tipo_relacao || '').toUpperCase();
  if (!origem || /^0+$/.test(origem) || !destino || /^0+$/.test(destino)) throw new Error('Correlação NCM possui código inválido');
  if (!['DIRETA', 'PARCIAL_EX'].includes(tipo)) throw new Error('Tipo de relação histórica inválido');
  const fonte = String(linha?.fonte || '').trim();
  const hash = String(linha?.hash_origem || '').trim();
  if (!fonte || !hash) throw new Error('Fonte e hash são obrigatórios na correlação histórica');
  return {
    origem, destino, tipo, fonte, hash,
    versao_origem: String(linha?.versao_origem || '').trim(),
    versao_destino: String(linha?.versao_destino || '').trim(),
    vigencia_inicio: String(linha?.vigencia_inicio || '').trim() || null,
    evidencia: String(linha?.evidencia || '').trim(),
  };
}

function importarArquivo({ arquivo, aplicar = false, db = dbPadrao } = {}) {
  if (!arquivo) throw new Error('Arquivo de correlação histórica é obrigatório');
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const relacoes = Array.isArray(dados.relacoes) ? dados.relacoes : [];
  const validadas = relacoes.map(validar);
  const resumo = { relacoes_lidas: validadas.length, aplicado: Boolean(aplicar), hash_arquivo: dados.hash_arquivo || '' };
  if (!aplicar) return resumo;
  const inserir = db.prepare(`INSERT OR IGNORE INTO referencias_fiscais_correlacoes_historicas
    (dominio,codigo_origem,codigo_destino,tipo_relacao,versao_origem,versao_destino,vigencia_inicio,fonte,hash_origem,evidencia)
    VALUES ('NCM',?,?,?,?,?,?,?,?,?)`);
  let inseridas = 0;
  db.transaction(() => validadas.forEach((x) => {
    inseridas += inserir.run(x.origem, x.destino, x.tipo, x.versao_origem, x.versao_destino, x.vigencia_inicio, x.fonte, x.hash, x.evidencia).changes;
  }))();
  return { ...resumo, inseridas, existentes: validadas.length - inseridas };
}

// Só é resolvida uma relação oficial direta e unívoca. Relações "ex" ou
// múltiplos destinos permanecem pendentes e jamais são escolhidas por heurística.
function resolver({ ncm, db = dbPadrao } = {}) {
  const origem = normalizarNcm(ncm);
  const linhas = db.prepare(`SELECT codigo_destino,tipo_relacao,fonte,hash_origem,evidencia
    FROM referencias_fiscais_correlacoes_historicas WHERE dominio='NCM' AND codigo_origem=?
    ORDER BY codigo_destino`).all(origem);
  const diretas = [...new Set(linhas.filter((x) => x.tipo_relacao === 'DIRETA').map((x) => x.codigo_destino))];
  if (diretas.length === 1 && linhas.length === 1) return { status: 'RESOLVIDA_OFICIALMENTE', codigo_origem: origem, codigo_resolvido: diretas[0], evidencia: linhas[0] };
  return { status: linhas.length ? 'PENDENTE_CORRELACAO_NAO_UNIVOCA' : 'SEM_CORRELACAO_HISTORICA', codigo_origem: origem, candidatos: linhas };
}

module.exports = { importarArquivo, resolver };

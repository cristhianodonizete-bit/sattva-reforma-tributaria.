/**
 * BASES DE CLASSIFICAÇÃO TRIBUTÁRIA DA REFORMA
 * ---------------------------------------------------------------------------
 * Duas bases distintas e complementares:
 *
 *  SERVIÇOS  — chave Item LC 116 + NBS. Define o cClassTrib, o INDOP (indicador
 *              de operação) e o local de incidência do IBS. Uma mesma NBS pode
 *              ter classificação diferente conforme o item da LC 116, por isso
 *              a chave é composta.
 *
 *  MERCADORIAS — chave NCM. Define CST, cClassTrib, anexo da LC 214, fundamento
 *              legal e os percentuais de redução de IBS e CBS. Um mesmo NCM pode
 *              ter MAIS DE UM candidato (ex.: um medicamento que se enquadra
 *              tanto no Anexo IV a 60% quanto na lista de alíquota zero). Nesses
 *              casos o sistema NÃO escolhe sozinho: marca como "requer decisão"
 *              e o consultor define a regra para aquele cliente.
 *
 * As duas bases alimentam a classificação automática da movimentação importada,
 * que por sua vez alimenta o cálculo com a redução correta em vez do padrão.
 */
const XLSX = require('xlsx');
const db = require('../db');

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const txt = (v) => String(v == null ? '' : v).trim();
const perc = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;   // aceita 60 ou 0,60
};

/** LC 116 sempre em 4 dígitos sem separador: "01.01" e "010101" viram "0101" */
const normLc116 = (v) => {
  const d = soDigitos(v);
  return d ? d.slice(0, 4).padStart(4, '0') : '';
};
/** NBS em dígitos puros; NCM em 8 dígitos */
const normNbs = (v) => soDigitos(v);
const normNcm = (v) => { const d = soDigitos(v); return d ? d.slice(0, 8).padStart(8, '0') : ''; };

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

/** Localiza a coluna pelo nome do cabeçalho, tolerando acento/caixa/espaço */
function acha(linha, nomes) {
  for (const k of Object.keys(linha)) {
    const n = normalizar(k);
    if (nomes.some((x) => n === normalizar(x))) return linha[k];
  }
  for (const k of Object.keys(linha)) {
    const n = normalizar(k);
    if (nomes.some((x) => { const y = normalizar(x); return y.length >= 4 && n.includes(y); })) return linha[k];
  }
  return '';
}

function lerAba(buffer, preferidas) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  let nome = wb.SheetNames.find((s) => preferidas.some((p) => normalizar(s) === normalizar(p)));
  if (!nome) {
    // escolhe a aba com mais linhas
    nome = wb.SheetNames.map((s) => ({ s, n: XLSX.utils.sheet_to_json(wb.Sheets[s], { defval: '' }).length }))
      .sort((a, b) => b.n - a.n)[0].s;
  }
  return { aba: nome, abas: wb.SheetNames, linhas: XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: '' }) };
}

// ==========================================================================
// SERVIÇOS — LC 116 + NBS
// ==========================================================================
function importarServicos(buffer, opcoes = {}) {
  const { linhas, aba, abas } = lerAba(buffer, [opcoes.aba, 'tabela geral', 'correlacao']);
  if (!linhas.length) throw new Error('Planilha sem linhas de dados.');

  const registros = [];
  const mensagens = [];
  let ignorados = 0;

  for (const l of linhas) {
    const lc116 = normLc116(acha(l, ['Item LC 116', 'item lc116', 'lc116', 'item']));
    const nbs = normNbs(acha(l, ['NBS', 'codigo nbs']));
    if (!lc116 && !nbs) { ignorados++; continue; }
    registros.push({
      lc116, nbs,
      descricao_item: txt(acha(l, ['Descrição Item', 'descricao item'])),
      descricao_nbs: txt(acha(l, ['DESCRIÇÃO NBS', 'descricao nbs'])),
      onerosa: txt(acha(l, ['PS ONEROSA? (S/N)', 'ps onerosa', 'onerosa'])).toUpperCase().slice(0, 1),
      exterior: txt(acha(l, ['ADQ EXTERIOR? (S/N)', 'adq exterior', 'exterior'])).toUpperCase().slice(0, 1),
      indop: txt(acha(l, ['INDOP', 'ind op'])),
      local_incidencia: txt(acha(l, ['Local incidência IBS', 'local incidencia', 'local de incidencia'])),
      cclasstrib: txt(acha(l, ['cClassTrib', 'classtrib'])),
      nome_cclasstrib: txt(acha(l, ['nome cClassTrib', 'nome classtrib', 'classificacao'])),
    });
  }
  if (!registros.length) throw new Error(`Nenhum registro reconhecido na aba "${aba}". Confira se ela tem as colunas Item LC 116 e NBS.`);
  if (!registros.some((r) => r.cclasstrib)) mensagens.push('Coluna cClassTrib não encontrada — a base ficará sem o código de classificação tributária.');

  db.prepare('DELETE FROM base_servicos').run();
  const ins = db.prepare(`INSERT INTO base_servicos (lc116, nbs, descricao_item, descricao_nbs, onerosa,
    exterior, indop, local_incidencia, cclasstrib, nome_cclasstrib, reducao)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const r of registros) {
      ins.run(r.lc116, r.nbs, r.descricao_item, r.descricao_nbs, r.onerosa, r.exterior,
        r.indop, r.local_incidencia, r.cclasstrib, r.nome_cclasstrib, reducaoPorClassTrib(r.cclasstrib, r.nome_cclasstrib));
    }
  })();
  registrarBase('servicos', opcoes.arquivo || 'correlacao.xlsx', registros.length, aba);
  return { importados: registros.length, ignorados, aba, abas, mensagens };
}

// ==========================================================================
// MERCADORIAS — NCM
// ==========================================================================
function importarNcm(buffer, opcoes = {}) {
  const { linhas, aba, abas } = lerAba(buffer, [opcoes.aba, 'Detalhamento candidatos', 'ncms']);
  if (!linhas.length) throw new Error('Planilha sem linhas de dados.');

  const registros = [];
  let ignorados = 0;
  for (const l of linhas) {
    const ncm = normNcm(acha(l, ['NCM', 'codigo ncm', 'ncm normalizado']));
    if (!ncm || ncm === '00000000') { ignorados++; continue; }
    const rIbs = perc(acha(l, ['Redução IBS (%)', 'reducao ibs']));
    const rCbs = perc(acha(l, ['Redução CBS (%)', 'reducao cbs']));
    registros.push({
      ncm,
      descricao: txt(acha(l, ['Descrição NCM', 'descricao ncm', 'descricao'])),
      cst: txt(acha(l, ['CST IBS/CBS', 'cst'])),
      cclasstrib: txt(acha(l, ['cClassTrib', 'classtrib'])),
      classificacao: txt(acha(l, ['Classificação', 'classificacao'])),
      anexo: txt(acha(l, ['Anexo', 'Anexo(s) LC 214', 'anexo lc214'])),
      fundamento: txt(acha(l, ['Fundamento'])),
      reducao_ibs: rIbs, reducao_cbs: rCbs,
      regra: txt(acha(l, ['Regra objetiva / como proceder', 'regra objetiva', 'como proceder'])),
      fonte: txt(acha(l, ['Fonte'])),
    });
  }
  if (!registros.length) throw new Error(`Nenhum NCM válido reconhecido na aba "${aba}".`);

  // Marca NCMs com mais de um candidato — exigem decisão do consultor
  const contagem = new Map();
  registros.forEach((r) => contagem.set(r.ncm, (contagem.get(r.ncm) || 0) + 1));

  db.prepare('DELETE FROM base_ncm').run();
  const ins = db.prepare(`INSERT INTO base_ncm (ncm, descricao, cst, cclasstrib, classificacao, anexo,
    fundamento, reducao_ibs, reducao_cbs, regra, fonte, candidatos, reducao)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const r of registros) {
      ins.run(r.ncm, r.descricao, r.cst, r.cclasstrib, r.classificacao, r.anexo, r.fundamento,
        r.reducao_ibs, r.reducao_cbs, r.regra, r.fonte, contagem.get(r.ncm),
        reducaoPorPercentual(r.reducao_ibs, r.reducao_cbs, r.cst));
    }
  })();
  const multiplos = [...contagem.values()].filter((c) => c > 1).length;
  registrarBase('ncm', opcoes.arquivo || 'ncms.xlsx', registros.length, aba);
  return { importados: registros.length, ignorados, unicos: contagem.size, comMultiplosCandidatos: multiplos, aba, abas };
}

// ==========================================================================
// TRADUÇÃO PARA O MOTOR DE CÁLCULO
// ==========================================================================
/** Converte percentuais de redução na chave usada em parametros.REDUCOES */
function reducaoPorPercentual(rIbs, rCbs, cst) {
  const r = rIbs != null ? rIbs : rCbs;
  const c = String(cst || '');
  if (c.startsWith('4')) return 'imune';        // 400 isenção / 410 imunidade
  if (c.startsWith('6') || c.startsWith('8')) return 'especifico';
  if (r == null) return 'integral';
  if (r >= 0.99) return 'reducao_100';
  if (r >= 0.55 && r <= 0.65) return 'reducao_60';
  if (r >= 0.25 && r <= 0.35) return 'reducao_30';
  if (r <= 0.001) return 'integral';
  return 'especifico';
}

/** Deduz a redução a partir do cClassTrib/descrição da base de serviços */
function reducaoPorClassTrib(cclasstrib, nome) {
  const c = String(cclasstrib || '');
  const n = normalizar(nome);
  if (c.startsWith('0000')) return 'integral';
  if (n.includes('profissoesintelectuais') || n.includes('profissaointelectual')) return 'reducao_30';
  if (c.startsWith('011') || n.includes('planosdeassistencia') || n.includes('regimeespecifico')
      || n.includes('hotelaria') || n.includes('agenciasdeturismo') || n.includes('bensimoveis')
      || n.includes('servicosfinanceiros') || n.includes('cooperativa') || n.includes('bareserestaurantes')) return 'especifico';
  if (c.startsWith('4')) return 'imune';
  if (c.startsWith('2')) return 'reducao_60';
  return 'integral';
}

// ==========================================================================
// CONSULTA
// ==========================================================================
function consultarNcm(ncm) {
  const c = normNcm(ncm);
  if (!c) return { encontrado: false };
  let linhas = db.prepare('SELECT * FROM base_ncm WHERE ncm = ? ORDER BY cclasstrib').all(c);
  let nivel = 'exato';
  if (!linhas.length) {   // tenta por posição/subposição (6 e 4 dígitos)
    linhas = db.prepare('SELECT * FROM base_ncm WHERE ncm LIKE ? ORDER BY ncm LIMIT 20').all(`${c.slice(0, 6)}%`);
    nivel = linhas.length ? 'posicao' : nivel;
  }
  if (!linhas.length) {
    linhas = db.prepare('SELECT * FROM base_ncm WHERE ncm LIKE ? ORDER BY ncm LIMIT 20').all(`${c.slice(0, 4)}%`);
    nivel = linhas.length ? 'subposicao' : nivel;
  }
  if (!linhas.length) return { encontrado: false, ncm: c };
  return {
    encontrado: true, ncm: c, nivel,
    candidatos: linhas,
    unico: linhas.length === 1,
    reducao: linhas.length === 1 ? linhas[0].reducao : null,
    requerDecisao: linhas.length > 1,
  };
}

function consultarServico(lc116, nbs) {
  const l = normLc116(lc116), n = normNbs(nbs);
  let linhas = [];
  if (l && n) linhas = db.prepare('SELECT * FROM base_servicos WHERE lc116 = ? AND nbs = ?').all(l, n);
  if (!linhas.length && n) linhas = db.prepare('SELECT * FROM base_servicos WHERE nbs = ?').all(n);
  if (!linhas.length && l) linhas = db.prepare('SELECT * FROM base_servicos WHERE lc116 = ? LIMIT 20').all(l);
  if (!linhas.length) return { encontrado: false, lc116: l, nbs: n };
  const chave = l && n && linhas.length === 1;
  return {
    encontrado: true, lc116: l, nbs: n,
    nivel: chave ? 'exato' : (n ? 'nbs' : 'lc116'),
    candidatos: linhas, unico: linhas.length === 1,
    reducao: linhas.length === 1 ? linhas[0].reducao : null,
    requerDecisao: linhas.length > 1,
  };
}

function buscar(termo, limite = 60) {
  const t = `%${txt(termo)}%`;
  const d = soDigitos(termo);
  const ncm = db.prepare(`SELECT * FROM base_ncm WHERE ncm LIKE ? OR descricao LIKE ? OR classificacao LIKE ?
    ORDER BY ncm LIMIT ?`).all(d ? `${d}%` : '%\u0000%', t, t, limite);
  const serv = db.prepare(`SELECT * FROM base_servicos WHERE nbs LIKE ? OR lc116 LIKE ? OR descricao_item LIKE ?
    OR descricao_nbs LIKE ? OR nome_cclasstrib LIKE ? ORDER BY lc116, nbs LIMIT ?`)
    .all(d ? `${d}%` : '%\u0000%', d ? `${d}%` : '%\u0000%', t, t, t, limite);
  return { ncm, servicos: serv };
}

// ==========================================================================
// CLASSIFICAÇÃO EM LOTE DA MOVIMENTAÇÃO
// ==========================================================================
/**
 * Percorre a movimentação da empresa e grava a redução correta em cada
 * lançamento, a partir do NCM (mercadorias) ou LC116+NBS (serviços).
 * Lançamentos com mais de um candidato ficam marcados como pendentes de
 * decisão — o sistema não escolhe sozinho.
 */
function classificarMovimentos(empresaId) {
  const movs = db.prepare('SELECT id, ncm, nbs, cst FROM movimentos WHERE empresa_id = ?').all(empresaId);
  const up = db.prepare('UPDATE movimentos SET reducao = ?, cclasstrib = ?, classificacao_origem = ? WHERE id = ?');
  const r = { total: movs.length, porNcm: 0, porNbs: 0, requerDecisao: 0, naoEncontrado: 0 };

  db.transaction(() => {
    for (const m of movs) {
      let res = null, origem = '';
      if (m.ncm) { res = consultarNcm(m.ncm); origem = 'ncm'; }
      if ((!res || !res.encontrado) && (m.nbs || m.cst)) { res = consultarServico(m.cst, m.nbs); origem = 'nbs'; }
      if (!res || !res.encontrado) { r.naoEncontrado++; up.run('integral', '', 'nao_encontrado', m.id); continue; }
      if (res.requerDecisao) {
        r.requerDecisao++;
        up.run('integral', '', `requer_decisao:${origem}`, m.id);
        continue;
      }
      const c = res.candidatos[0];
      up.run(res.reducao || 'integral', c.cclasstrib || '', `${origem}:${res.nivel}`, m.id);
      if (origem === 'ncm') r.porNcm++; else r.porNbs++;
    }
  })();
  return r;
}

/** Itens que exigem decisão do consultor, agrupados por NCM/NBS */
function pendencias(empresaId) {
  const ncm = db.prepare(`SELECT m.ncm, COUNT(*) itens, SUM(m.valor) valor,
      MIN(m.descricao) exemplo
    FROM movimentos m WHERE m.empresa_id = ? AND m.classificacao_origem LIKE 'requer_decisao%'
      AND m.ncm <> '' GROUP BY m.ncm ORDER BY valor DESC`).all(empresaId);
  return ncm.map((x) => ({ ...x, candidatos: consultarNcm(x.ncm).candidatos || [] }));
}

/** Grava a decisão do consultor para um NCM em toda a movimentação da empresa */
function decidir(empresaId, ncm, cclasstrib) {
  const c = normNcm(ncm);
  const cand = db.prepare('SELECT * FROM base_ncm WHERE ncm = ? AND cclasstrib = ?').get(c, cclasstrib);
  if (!cand) throw new Error('Candidato não encontrado para este NCM.');
  db.prepare(`INSERT INTO base_decisoes (empresa_id, chave, tipo, cclasstrib, reducao)
    VALUES (?,?, 'ncm', ?, ?)
    ON CONFLICT(empresa_id, chave, tipo) DO UPDATE SET cclasstrib = excluded.cclasstrib, reducao = excluded.reducao`)
    .run(empresaId, c, cclasstrib, cand.reducao);
  const r = db.prepare(`UPDATE movimentos SET reducao = ?, cclasstrib = ?, classificacao_origem = 'decisao'
    WHERE empresa_id = ? AND ncm = ?`).run(cand.reducao, cclasstrib, empresaId, c);
  return { atualizados: r.changes, reducao: cand.reducao };
}

function registrarBase(tipo, arquivo, registros, aba) {
  db.prepare(`INSERT INTO base_importacoes (tipo, arquivo, aba, registros) VALUES (?,?,?,?)`)
    .run(tipo, arquivo, aba, registros);
}

function estatisticas() {
  const ncm = db.prepare('SELECT COUNT(*) linhas, COUNT(DISTINCT ncm) unicos FROM base_ncm').get();
  const serv = db.prepare('SELECT COUNT(*) linhas, COUNT(DISTINCT nbs) nbs, COUNT(DISTINCT lc116) lc116 FROM base_servicos').get();
  const mult = db.prepare('SELECT COUNT(DISTINCT ncm) c FROM base_ncm WHERE candidatos > 1').get().c;
  const imports = db.prepare('SELECT * FROM base_importacoes ORDER BY id DESC LIMIT 10').all();
  return { ncm: { ...ncm, comMultiplosCandidatos: mult }, servicos: serv, importacoes: imports };
}

module.exports = { importarServicos, importarNcm, consultarNcm, consultarServico, buscar,
  classificarMovimentos, pendencias, decidir, estatisticas, normNcm, normLc116, normNbs };

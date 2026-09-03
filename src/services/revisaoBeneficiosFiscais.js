/**
 * Decisões humanas sobre benefícios fiscais.
 *
 * O XML e os campos originais de movimentos nunca são alterados aqui. A
 * decisão é uma camada auditável, aplicada pelo classificador somente aos
 * itens vinculados e passível de reversão.
 */
const db = require('../db');
const bases = require('./basesReforma');

const txt = (v) => String(v == null ? '' : v).trim();
const dig = (v) => txt(v).replace(/\D/g, '');
const lc = (v) => bases.normLc116(v);
const nbs = (v) => bases.normNbs(v);

function candidatos(lc116, codigoNbs) {
  return bases.consultarServico(lc116, codigoNbs).candidatos || [];
}

function candidatoCompativel(lc116, codigoNbs, cclasstrib) {
  const codigo = txt(cclasstrib);
  return candidatos(lc116, codigoNbs).find((x) => txt(x.cclasstrib) === codigo) || null;
}

function obterMovimentosBeneficiados(empresaId, movimentoIds) {
  if (!Array.isArray(movimentoIds) || !movimentoIds.length) return [];
  return db.prepare(`SELECT r.movimento_id, r.cclasstrib, r.cst, r.detalhe,
      m.lc116, m.nbs, m.cst AS cst_documento, m.documento, m.item_numero
    FROM motor_resultados r JOIN movimentos m ON m.id=r.movimento_id
    WHERE r.empresa_id=? AND r.sentido='saida' AND r.movimento_id IN (${movimentoIds.map(() => '?').join(',')})`)
    .all(empresaId, ...movimentoIds).map((x) => {
      let detalhe = {}; try { detalhe = JSON.parse(x.detalhe || '{}'); } catch (_) { /* inválido */ }
      const classificacao = detalhe.classificacao || {};
      const reducao = Number(classificacao.reducaoCbs ?? classificacao.reducao_cbs ?? 0);
      const especial = reducao > 0 || ['zero', 'reducao_100'].includes(String(classificacao.reducao || '').toLowerCase());
      return { ...x, detalhe, lc116: lc(x.lc116 || classificacao?.candidatos?.[0]?.lc116 || x.cst_documento), nbs: nbs(x.nbs), especial };
    }).filter((x) => x.especial);
}

function expandirEscopoEmpresa(empresaId, referencia) {
  const linhas = db.prepare(`SELECT r.movimento_id, r.cclasstrib, r.detalhe, m.lc116, m.nbs, m.cst AS cst_documento
    FROM motor_resultados r JOIN movimentos m ON m.id=r.movimento_id
    WHERE r.empresa_id=? AND r.sentido='saida' AND r.cclasstrib=?`).all(empresaId, referencia.cclasstrib);
  return linhas.map((x) => {
    let detalhe = {}; try { detalhe = JSON.parse(x.detalhe || '{}'); } catch (_) { /* inválido */ }
    const classificacao = detalhe.classificacao || {};
    return { ...x, detalhe, lc116: lc(x.lc116 || classificacao?.candidatos?.[0]?.lc116 || x.cst_documento), nbs: nbs(x.nbs) };
  }).filter((x) => x.lc116 === referencia.lc116 && x.nbs === referencia.nbs);
}

function criar(empresaId, dados) {
  const ids = [...new Set((dados.movimento_ids || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new Error('Selecione ao menos um documento/item para revisar.');
  const itensIniciais = obterMovimentosBeneficiados(empresaId, ids);
  if (itensIniciais.length !== ids.length) throw new Error('A revisão aceita somente itens em que um benefício fiscal foi efetivamente aplicado pelo motor.');
  const assinatura = itensIniciais[0];
  if (!assinatura.lc116 || !assinatura.nbs || !assinatura.cclasstrib) throw new Error('A operação selecionada não possui LC 116, NBS e cClassTrib suficientes para uma revisão auditável.');
  if (itensIniciais.some((x) => x.lc116 !== assinatura.lc116 || x.nbs !== assinatura.nbs || txt(x.cclasstrib) !== txt(assinatura.cclasstrib))) {
    throw new Error('Para uma única revisão, selecione itens com a mesma LC 116, NBS e cClassTrib atualmente aplicado.');
  }
  const novo = candidatoCompativel(assinatura.lc116, assinatura.nbs, dados.nova_cclasstrib);
  if (!novo) throw new Error('A nova cClassTrib deve ser uma opção compatível com a LC 116 e a NBS do item.');
  if (txt(novo.cclasstrib) === txt(assinatura.cclasstrib)) throw new Error('Escolha uma nova cClassTrib diferente da classificação atualmente aplicada.');
  const motivo = txt(dados.motivo), justificativa = txt(dados.justificativa);
  if (!motivo || !justificativa) throw new Error('Informe o motivo e a justificativa técnica da revisão.');
  const escopo = dados.escopo === 'COMBINACAO_EMPRESA' ? 'COMBINACAO_EMPRESA' : 'ITENS_SELECIONADOS';
  const itens = escopo === 'COMBINACAO_EMPRESA' ? expandirEscopoEmpresa(empresaId, assinatura) : itensIniciais;
  if (!itens.length) throw new Error('Nenhum item atual corresponde à assinatura selecionada.');
  const anterior = db.prepare(`SELECT movimento_id,cclasstrib,cst,cbs,ibs,preco_projetado,status_classificacao,execucao_id
    FROM motor_resultados WHERE empresa_id=? AND movimento_id IN (${itens.map(() => '?').join(',')})`).all(empresaId, ...itens.map((x) => x.movimento_id));
  const execucao = db.prepare('SELECT id FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(empresaId);
  let id;
  db.transaction(() => {
    const r = db.prepare(`INSERT INTO revisoes_beneficios_fiscais
      (empresa_id,escopo,motivo,justificativa,evidencia,cclasstrib_origem,nova_cclasstrib,lc116,nbs,resultado_anterior_json,execucao_anterior_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(empresaId, escopo, motivo, justificativa, txt(dados.evidencia) || null,
      assinatura.cclasstrib, novo.cclasstrib, assinatura.lc116, assinatura.nbs, JSON.stringify(anterior), execucao?.id || null);
    id = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO revisoes_beneficios_itens (revisao_id,movimento_id) VALUES (?,?)');
    itens.forEach((x) => ins.run(id, x.movimento_id));
  })();
  return { id, movimento_ids: itens.map((x) => x.movimento_id), escopo, assinatura: { lc116: assinatura.lc116, nbs: assinatura.nbs, cclasstrib_origem: assinatura.cclasstrib }, novo };
}

function porMovimento(empresaId, movimentoIds) {
  if (!movimentoIds?.length) return new Map();
  const linhas = db.prepare(`SELECT r.id AS revisao_id,r.nova_cclasstrib,r.lc116,r.nbs,r.motivo,r.justificativa,
    i.movimento_id FROM revisoes_beneficios_fiscais r JOIN revisoes_beneficios_itens i ON i.revisao_id=r.id
    WHERE r.empresa_id=? AND r.status='ATIVA' AND i.movimento_id IN (${movimentoIds.map(() => '?').join(',')})
    ORDER BY r.id DESC`).all(empresaId, ...movimentoIds);
  const mapa = new Map();
  for (const x of linhas) if (!mapa.has(x.movimento_id)) {
    const candidato = candidatoCompativel(x.lc116, x.nbs, x.nova_cclasstrib);
    if (candidato) mapa.set(x.movimento_id, { ...x, candidato: { ...candidato, cst: candidato.cst || String(candidato.cclasstrib || '').slice(0, 3) } });
  }
  return mapa;
}

function registrarExecucaoPosterior(id, execucaoId) {
  db.prepare('UPDATE revisoes_beneficios_fiscais SET execucao_posterior_id=? WHERE id=?').run(execucaoId || null, id);
}

function listar(empresaId) {
  return db.prepare(`SELECT r.*, COUNT(i.movimento_id) AS itens FROM revisoes_beneficios_fiscais r
    LEFT JOIN revisoes_beneficios_itens i ON i.revisao_id=r.id WHERE r.empresa_id=?
    GROUP BY r.id ORDER BY r.id DESC`).all(empresaId);
}

function reverter(empresaId, id, motivo) {
  const r = db.prepare('SELECT * FROM revisoes_beneficios_fiscais WHERE id=? AND empresa_id=?').get(id, empresaId);
  if (!r) throw new Error('Revisão não encontrada.');
  if (r.status !== 'ATIVA') throw new Error('Esta revisão já foi revertida.');
  db.prepare(`UPDATE revisoes_beneficios_fiscais SET status='REVERTIDA',revertido_em=datetime('now','localtime'),motivo_reversao=? WHERE id=?`).run(txt(motivo) || 'Reversão registrada pelo usuário.', id);
  const ids = db.prepare('SELECT movimento_id FROM revisoes_beneficios_itens WHERE revisao_id=?').all(id).map((x) => x.movimento_id);
  return { revisao: r, movimento_ids: ids };
}

module.exports = { candidatos, criar, porMovimento, listar, reverter, registrarExecucaoPosterior };

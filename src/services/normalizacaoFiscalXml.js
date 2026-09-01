/*
 * Normalização operacional da evidência de serviço trazida por XML.
 *
 * Não classifica nem calcula tributos: apenas explicita se a chave documental
 * disponível (LC116 + NBS) é suficiente para seguir para o catálogo ou se a
 * revisão humana precisa completar uma evidência específica.
 */
const db = require('../db');

const somenteDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const normalizarLc116 = (v) => {
  const d = somenteDigitos(v).slice(0, 4);
  return d ? d.padStart(4, '0') : '';
};
// Alguns provedores de NFS-e trazem o item da lista apenas como os quatro
// primeiros dígitos do código fiscal municipal/nacional. O código bruto é
// preservado em `cst`; aqui apenas recuperamos a mesma evidência documental
// para a chave LC116, sem inventar classificação.
function lc116DoDocumento(movimento) {
  return normalizarLc116(movimento.lc116) || normalizarLc116(movimento.cst);
}

function avaliar(movimento) {
  const lc116 = lc116DoDocumento(movimento);
  const nbs = somenteDigitos(movimento.nbs);
  const cst = somenteDigitos(movimento.cst);
  const xmlServico = String(movimento.origem || '').toLowerCase() === 'xml'
    && !somenteDigitos(movimento.ncm) && Boolean(Number(movimento.iss || 0) || nbs || lc116 || cst);

  if (!xmlServico) return { status: 'NAO_APLICAVEL', pendencia: '', evidencia: '' };
  if (!lc116) {
    return {
      status: 'PENDENTE', pendencia: 'LC116_NAO_IDENTIFICADO',
      evidencia: cst ? `Código fiscal bruto do XML: ${cst}` : 'XML de serviço sem item LC116 identificado.',
    };
  }
  if (!nbs) {
    return {
      status: 'PENDENTE', pendencia: 'LC116_IDENTIFICADO_SEM_NBS',
      evidencia: `Item LC116: ${lc116}${cst ? ` · Código fiscal bruto do XML: ${cst}` : ''}`,
    };
  }
  return {
    status: 'VALIDADO', pendencia: '',
    evidencia: `Item LC116: ${lc116} · NBS: ${nbs}${cst ? ` · Código fiscal bruto do XML: ${cst}` : ''}`,
  };
}

function validarMovimento(movimentoId) {
  const movimento = db.prepare(`SELECT id, origem, ncm, nbs, lc116, cst, iss
    FROM movimentos WHERE id=?`).get(movimentoId);
  if (!movimento) throw new Error('Lançamento não encontrado para normalização.');
  const resultado = avaliar(movimento);
  db.prepare(`UPDATE movimentos
    SET lc116=?, normalizacao_status=?, normalizacao_pendencia=?, normalizacao_evidencia=?
    WHERE id=?`).run(lc116DoDocumento(movimento), resultado.status, resultado.pendencia, resultado.evidencia, movimentoId);
  return resultado;
}

module.exports = { normalizarLc116, lc116DoDocumento, avaliar, validarMovimento };

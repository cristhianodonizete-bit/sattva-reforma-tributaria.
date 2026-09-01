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

function avaliar(movimento) {
  const lc116 = normalizarLc116(movimento.lc116);
  const nbs = somenteDigitos(movimento.nbs);
  const cst = somenteDigitos(movimento.cst);
  const xmlServico = String(movimento.origem || '').toLowerCase() === 'xml'
    && !somenteDigitos(movimento.ncm) && Number(movimento.iss || 0) !== 0;

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
    WHERE id=?`).run(normalizarLc116(movimento.lc116), resultado.status, resultado.pendencia, resultado.evidencia, movimentoId);
  return resultado;
}

module.exports = { normalizarLc116, avaliar, validarMovimento };

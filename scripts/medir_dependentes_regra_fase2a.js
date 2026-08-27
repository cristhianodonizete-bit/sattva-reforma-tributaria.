#!/usr/bin/env node
const db = require('../src/db');
const regraId = process.argv[2] || 'LC214_ART4_OPERACAO_ONEROSA_V1';
const regra = db.prepare('SELECT * FROM regras_enquadramento WHERE id=?').get(regraId);
if (!regra) throw new Error('Regra não encontrada.');
// Uma regra sem chave operacional explícita não pode selecionar a carteira por
// aproximação. A regra de enquadramento geral usa fixture e fica com 0 dependentes.
const campos = [['ncm','ncm'], ['nbs','nbs'], ['cclasstrib','cclasstrib'], ['cst','cst'], ['cfop','cfop']]
  .filter(([campo]) => regra[campo]);
let dependentes = 0;
if (campos.length) {
  const onde = campos.map(([, coluna]) => `${coluna}=?`).join(' AND ');
  dependentes = db.prepare(`SELECT COUNT(*) c FROM movimentos WHERE ${onde}`).get(...campos.map(([campo]) => regra[campo])).c;
}
const carteira = db.prepare('SELECT COUNT(*) c FROM movimentos').get().c;
console.log(JSON.stringify({ regra: regraId, chaves_operacionais: campos.map(([campo]) => campo), dependentes, carteira, reprocessamento: dependentes ? 'SELETIVO_PENDENTE' : 'NAO_EXECUTADO_SEM_DEPENDENTES' }, null, 2));

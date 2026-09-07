/* Reconciliador somente-leitura de NCM operacional sem referência vigente. */
const db = require('../src/db');
const { reconciliarNcmsSemReferencia } = require('../src/services/auditoriaMatrizFiscal');

console.log(JSON.stringify(reconciliarNcmsSemReferencia({ db }), null, 2));
db.close();

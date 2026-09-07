/* Executa a auditoria reprodutível de identidade da matriz e proveniência. */
const db = require('../src/db');
const { auditar } = require('../src/services/auditoriaMatrizFiscal');

console.log(JSON.stringify(auditar({ db }), null, 2));
db.close();

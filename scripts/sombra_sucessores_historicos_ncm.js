/* Sombra local, reproduzível e somente-leitura de correlações históricas NCM. */
const db = require('../src/db');
const { sombraSucessoresHistoricosNcm } = require('../src/services/auditoriaMatrizFiscal');

try {
  console.log(JSON.stringify(sombraSucessoresHistoricosNcm({ db }), null, 2));
} finally {
  db.close();
}

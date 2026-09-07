/* Sombra local, reproduzível e somente-leitura de correlações históricas NCM. */
const db = require('../src/db');
const { sombraSucessoresHistoricosNcm, triagemEvidenciasSucessoresHistoricosNcm } = require('../src/services/auditoriaMatrizFiscal');

try {
  console.log(JSON.stringify({ sombra: sombraSucessoresHistoricosNcm({ db }), triagem_evidencias: triagemEvidenciasSucessoresHistoricosNcm({ db }) }, null, 2));
} finally {
  db.close();
}

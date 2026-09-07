const path = require('path');
const db = require('../src/db');
const { importarArquivo } = require('../src/services/correlacoesHistoricasNcm');
const args = process.argv.slice(2);
const indice = args.indexOf('--arquivo');
if (indice < 0 || !args[indice + 1]) throw new Error('Uso: node scripts/importar_correlacao_ncm_historica.js --arquivo correlacoes.json [--aplicar]');
console.log(JSON.stringify(importarArquivo({ arquivo: path.resolve(args[indice + 1]), aplicar: args.includes('--aplicar'), db }), null, 2));
db.close();

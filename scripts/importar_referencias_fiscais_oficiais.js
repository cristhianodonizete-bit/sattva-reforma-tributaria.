/*
 * Carga explícita de referências oficiais, fora do motor.
 * Uso: node scripts/importar_referencias_fiscais_oficiais.js --ncm caminho.json --nbs caminho.csv
 *      --lc116 caminho.csv | --lc116-html texto-oficial.html [--aplicar]
 */
const path = require('path');
const refs = require('../src/services/referenciasFiscaisOficiais');

const args = process.argv.slice(2);
const valor = (chave) => {
  const i = args.indexOf(chave);
  return i >= 0 ? args[i + 1] : null;
};
const arquivoNcm = valor('--ncm');
const arquivoNbs = valor('--nbs');
const arquivoLc116 = valor('--lc116');
const arquivoLc116Html = valor('--lc116-html');
if (!arquivoNcm && !arquivoNbs && !arquivoLc116 && !arquivoLc116Html) throw new Error('Informe --ncm, --nbs, --lc116 e/ou --lc116-html. A carga não consulta fontes externas automaticamente.');

const resultado = refs.importarReferenciasOficiais({
  arquivoNcm: arquivoNcm && path.resolve(arquivoNcm),
  arquivoNbs: arquivoNbs && path.resolve(arquivoNbs),
  arquivoLc116: arquivoLc116 && path.resolve(arquivoLc116),
  arquivoLc116Html: arquivoLc116Html && path.resolve(arquivoLc116Html),
  aplicar: args.includes('--aplicar'),
});
console.log(JSON.stringify(resultado, null, 2));

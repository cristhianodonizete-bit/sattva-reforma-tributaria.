/*
 * Carga explícita de referências oficiais, fora do motor.
 * Uso: node scripts/importar_referencias_fiscais_oficiais.js --ncm caminho.json --nbs caminho.csv [--aplicar]
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
if (!arquivoNcm && !arquivoNbs) throw new Error('Informe --ncm e/ou --nbs. A carga não consulta fontes externas automaticamente.');

const resultado = refs.importarReferenciasOficiais({
  arquivoNcm: arquivoNcm && path.resolve(arquivoNcm),
  arquivoNbs: arquivoNbs && path.resolve(arquivoNbs),
  aplicar: args.includes('--aplicar'),
});
console.log(JSON.stringify(resultado, null, 2));

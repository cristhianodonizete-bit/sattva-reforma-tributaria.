/* CST 06 identifica tratamento; não altera a escala nem zera percentuais. */
const assert = require('assert');
const { aplicarPercentual, arredondarMoeda } = require('../src/services/percentual');
const calcular = ({ cst_pis, cst_cofins, pis_percentual, cofins_percentual, base }) => ({
  cst_pis, cst_cofins,
  pis: arredondarMoeda(aplicarPercentual(base, pis_percentual)),
  cofins: arredondarMoeda(aplicarPercentual(base, cofins_percentual)),
});
const cumulativo = calcular({ cst_pis: '06', cst_cofins: '06', pis_percentual: 0.065, cofins_percentual: 0.30, base: 10000 });
const naoCumulativo = calcular({ cst_pis: '06', cst_cofins: '06', pis_percentual: 0.165, cofins_percentual: 0.76, base: 10000 });
assert.deepStrictEqual(cumulativo, { cst_pis: '06', cst_cofins: '06', pis: 6.5, cofins: 30 });
assert.deepStrictEqual(naoCumulativo, { cst_pis: '06', cst_cofins: '06', pis: 16.5, cofins: 76 });
console.log('CST 06 com percentual não zero: cumulativo e não cumulativo aprovados');

const assert = require('assert');
const sped = require('../src/services/importadorSped');

const arquivo = Buffer.from([
  '|0000|015|0|0||01012026|31012026|Empresa teste|06540179000156|MG|',
  '|C100|1|0||65|00|1|10|31260106540179000156650010000000101000000001|01012026|01012026|100|0|0|0|100|9|',
  '|C175|5102|100,00|0|01|100,00|1,65|||1,65|01|100,00|7,6|||7,60|',
  '|C100|1|0||55|00|1|11|31260106540179000156550010000000111000000001|01012026|01012026|10|0|0|0|10|9|',
  '|C170|1|ITEM|Produto|1|UN|10,00|0|0|01|5102|0|10|0|0|0|0|0||||||0|01|10|1,65|||0,17|01|10|7,6|||0,76|',
  '|C175|5102|10,00|0|01|10,00|1,65|||0,17|01|10,00|7,6|||0,76|',
].join('\n'), 'latin1');

const resultado = sped.lerSped(arquivo, '06540179000156');
const saidas = resultado.itens.filter((x) => x.sentido === 'saida');
assert.equal(saidas.length, 2, 'C175 é fallback e não duplica documento já detalhado em C170');
assert.equal(saidas.reduce((s, x) => s + x.valor, 0), 110);
const c175 = saidas.find((x) => x.origem_agregada === 'C175');
assert.equal(c175.cfop, '5102');
assert.equal(c175.pis, 1.65);
assert.equal(c175.cofins, 7.6);
assert.equal(c175.cst_pis, '01');
assert.equal(c175.cst_cofins, '01');

const monofasico = sped.lerSped(Buffer.from([
  '|0000|015|0|0||01012026|31012026|Empresa teste|06540179000156|MG|',
  '|C100|1|0||65|00|1|12|31260106540179000156650010000000121000000001|01012026|01012026|50|0|0|0|50|9|',
  '|C175|5405|50,00|0|04|0|0|||0|04|0|0|||0|',
].join('\n'), 'latin1'), '06540179000156').itens[0];
assert.equal(monofasico.valor, 50, 'CST monofásico continua sendo receita operacional');
assert.equal(monofasico.cst_pis, '04');
assert.equal(monofasico.cst_cofins, '04');
assert.ok(resultado.avisos.some((x) => x.includes('C175')));
console.log('importador-sped-c175.test.js: OK');

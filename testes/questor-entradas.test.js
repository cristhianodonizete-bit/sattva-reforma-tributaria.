const assert=require('assert');
const { lerConferenciaEntradasQuestor }=require('../src/routes/conectorQuestor');
const texto=`Período: 01/01/2026 a 31/07/2026
8949  01/03  1054  NFE  1  7755483  01/03  55  1.407  MG ICMS 0 936,20 0,00
Fornecedor: PANIFICADORA QUINTELLI LTDA | 53.845.117/0001-32 | MG
1 DESPESA COM LANCHES 1905.90.90 1,00 936,20 936,20 0,00 0,00`;
const [nota]=lerConferenciaEntradasQuestor(texto);
assert.equal(nota.documento,'1054'); assert.equal(nota.serie,'1'); assert.equal(nota.data,'2026-03-01');
assert.equal(nota.cnpj,'53845117000132'); assert.equal(nota.valor,936.20); assert.equal(nota.itens.length,1);
assert.equal(nota.itens[0].ncm,'19059090'); assert.equal(nota.itens[0].valor,936.20);
console.log('questor-entradas.test: relatório de entradas reconhecido por nota e item.');

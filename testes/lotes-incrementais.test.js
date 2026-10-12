const assert=require('node:assert/strict');
const lotes=require('../src/services/lotesIncrementais');

const ids=Array.from({length:1508},(_,i)=>i+1);
const divididos=lotes.dividir(ids,100);
assert.equal(divididos.length,16);
assert.equal(divididos.flat().length,1508);
assert.ok(divididos.every((lote)=>lote.length<=100));
assert.deepEqual(divididos.flat(),ids);
assert.equal(lotes.pendentes(divididos,7).length,9,'retomada deve ignorar lotes já confirmados');
assert.deepEqual(lotes.dividir([1,1,2,2,3],25).flat(),[1,2,3],'ids repetidos não podem gerar cálculo duplicado');
console.log('lotes-incrementais: 1508 itens segmentados e retomada por checkpoint validados');

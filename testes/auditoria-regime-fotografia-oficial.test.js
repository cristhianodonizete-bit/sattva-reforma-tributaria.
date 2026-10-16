'use strict';
const assert=require('node:assert/strict');
const {execucaoDaFotografiaOficial}=require('../src/services/fotografiaOficial');

const consultas=[];
const db={prepare(sql){
  consultas.push(sql);
  return {get(){
    if(sql.includes('fotografia_oficial'))return {id:42};
    return {id:999};
  }};
}};

assert.deepEqual(execucaoDaFotografiaOficial(db,7),{id:42});
assert.ok(consultas[0].includes('fotografia_oficial'),'a auditoria deve preferir o ponteiro oficial');
assert.equal(consultas.length,1,'não pode consultar a última execução quando há fotografia oficial');
const semPonteiro={prepare(sql){return {get(){return sql.includes('fotografia_oficial') ? null : {id:9};}};}};
assert.deepEqual(execucaoDaFotografiaOficial(semPonteiro,7),{id:9},'instalação legada usa fallback somente sem ponteiro');
console.log('PASS auditoria de regime lê somente a execução da fotografia oficial.');

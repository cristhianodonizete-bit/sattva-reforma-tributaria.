const assert=require('node:assert');
const matriz=require('../src/services/matrizPisCofinsEntradaManual');

const padroes={
  simples_nacional:{pis:null,cofins:null,pis_cofins:2.5,tratamento_atual:'Simples'},
  lucro_real:{pis:1.65,cofins:7.6,tratamento_atual:'Não cumulativo'},
  lucro_presumido:{pis:0.65,cofins:3,tratamento_atual:'Cumulativo'},
};

const regular=matriz.normalizar({regimes:{lucro_real:{pis:0,cofins:0},lucro_presumido:{pis:0,cofins:0}}},'MATERIAL_ESCRITORIO',padroes).regra;
assert.deepStrictEqual(regular.regimes.lucro_real,{pis:1.65,cofins:7.6,tratamento_atual:'Não cumulativo'});
assert.deepStrictEqual(regular.regimes.lucro_presumido,{pis:0.65,cofins:3,tratamento_atual:'Cumulativo'});
assert.deepStrictEqual(regular.regimes.simples_nacional,{pis:null,cofins:null,pis_cofins:2.5,tratamento_atual:'Simples'});

const cumulativa=matriz.normalizar({},'LICENCA_USO_SISTEMAS_SOFTWARE',padroes).regra;
assert.equal(cumulativa.cumulatividade_obrigatoria,true);
assert.equal(cumulativa.regimes.lucro_real.pis,0.65);
assert.equal(cumulativa.regimes.lucro_real.cofins,3);

const semIncidencia=matriz.normalizar({},'IPTU_TAXAS_PUBLICAS',padroes).regra;
for(const regime of matriz.REGIMES){assert.equal(semIncidencia.regimes[regime].pis_cofins,0);}

const novamente=matriz.normalizar(regular,'MATERIAL_ESCRITORIO',padroes);
assert.equal(novamente.converteu,false,'a migração precisa ser idempotente');

console.log('matriz-pis-cofins-entrada-manual: três cadastros, alíquotas e exceções: OK');

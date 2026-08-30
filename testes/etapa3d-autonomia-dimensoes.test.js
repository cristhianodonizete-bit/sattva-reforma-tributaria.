const assert=require('assert');const{avaliarDimensoes}=require('../src/services/autonomiaDimensoes');
const s=avaliarDimensoes({sentido:'saida',base_economica:100,cbs:9.21,cclasstrib:'',status_credito_determinacao:'SUJEITO_VALIDACAO'},{nbsEquivalentes:true});
assert.equal(s.autonomia_calculo_cbs_propria,true);assert.equal(s.autonomia_credito_cliente,false);assert.equal(s.autonomia_classificatoria,'PARCIAL');assert.equal(s.autonomia_diagnostico_completo,false);
const e=avaliarDimensoes({sentido:'entrada',base_economica:100,cbs:9.21,cclasstrib:'000001',status_credito_determinacao:'SUJEITO_VALIDACAO'});assert.equal(e.autonomia_credito_entrada,false);assert.equal(e.autonomia_diagnostico_completo,false);
console.log('Etapa 3D: dimensões independentes de autonomia aprovadas.');

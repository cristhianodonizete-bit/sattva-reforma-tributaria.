const assert=require('assert');const {normalizar}=require('../src/services/evidenciaXml');
const cheio=normalizar({empresa_id:1,movimento_id:2,hash_lineage:'h',movimento:{documento:'1/2'},xml:{pis_cofins_documentado:true,pis:1,cofins:2,cst_pis:'01',cst_cofins:'01',base_pis:100,base_cofins:100,aliquota_pis:.0165,aliquota_cofins:.076}});
assert.equal(cheio.tipo_fonte,'XML_DFE');assert.equal(cheio.base_pis,100);assert.equal(cheio.pis_documentado,1);
const parcial=normalizar({empresa_id:1,movimento_id:3,xml:{}});assert.equal(parcial.cst_pis,null);assert.equal(parcial.base_pis,null);assert.equal(parcial.pis_documentado,null);
console.log('etapa3e4b1-evidencia-xml.test: ausência preservada e evidência normalizada');

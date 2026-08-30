const assert=require('assert');const{avaliar}=require('../src/services/orquestradorEnriquecimento');
const e={fonte:'DOCUMENTO_FISCAL_ORIGINAL',validada:true,versao_fonte:'1',hash_evidencia:'a',dados:{PIS_DOCUMENTADO:1,COFINS_DOCUMENTADA:2,SPED_OU_REFERENCIA_FISCAL_VALIDADA:'ok'}};
assert.equal(avaliar({tipo_pendencia:'SEM_BASE_PIS_COFINS'},[e]).status,'RESOLVIDA_AUTOMATICAMENTE');
assert.equal(avaliar({tipo_pendencia:'SEM_NBS',tipo:'SERVICO'},[]).status,'CONTINUA_INDETERMINADA');
const conflito=avaliar({tipo_pendencia:'SEM_BASE_PIS_COFINS'},[e,{...e,fonte:'REGRA_VERSIONADA',hash_evidencia:'b',dados:{PIS_DOCUMENTADO:9}}]);assert.equal(conflito.status,'REQUER_VALIDACAO');
assert.equal(avaliar({tipo_pendencia:'SEM_BASE_PIS_COFINS'},[e]).hash_entrada,avaliar({tipo_pendencia:'SEM_BASE_PIS_COFINS'},[e]).hash_entrada);
console.log('Etapa 2R: shadow, precedência, conflito e idempotência aprovados.');

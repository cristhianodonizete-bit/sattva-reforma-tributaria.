'use strict';
const assert=require('node:assert/strict');
const { listar }=require('../src/services/auditoriaRegimeVigencia');
const cnpj='03773700004013';
const itens=[{movimento_id:7,cnpj,documento:'A',competencia:'2024-07',data_emissao:null,regime_fotografia:'imune_isento',versao_fotografia:0},{movimento_id:8,cnpj,documento:'B',competencia:'2025-07',data_emissao:null,regime_fotografia:'imune_isento',versao_fotografia:0}];
const db={prepare(sql){return {get(){return sql.includes('motor_execucoes')?{id:99}:null;},all(){if(sql.includes('motor_resultados'))return itens;if(sql.includes('historico_regimes_parceiro'))return [];if(sql.includes('base_regime'))return [{cnpj:'03773700',raiz:'03773700',regime:'imune_isento',ano:2024,fonte:'Base RFB 2024'}];if(sql.includes('contraparte_regime_evidencias'))return [];throw new Error('Consulta inesperada: '+sql);}};}};
(async()=>{
const r=await listar(db,2);
assert.equal(r.execucao_id,99);
assert.equal(r.itens[0].status,'ATUAL','a evidência de 2024 deve validar documento de 2024');
assert.equal(r.itens[1].status,'SEM_HISTORICO','a evidência anual não pode ser estendida para 2025');
assert.deepEqual(r.resumo,{total:2,atual:1,divergente:0,sem_historico:1});
assert.deepEqual(r.cobertura,[
  {ano:'2024',documentos:1,cnpjs:1,com_cobertura:1,sem_cobertura:0,fontes:[{fonte:'Base RFB 2024',documentos:1}]},
  {ano:'2025',documentos:1,cnpjs:1,com_cobertura:0,sem_cobertura:1,fontes:[]},
],'a cobertura deve separar o período efetivamente provado do período sem evidência');
console.log('auditoria-regime-vigencia.test.js: OK');
})().catch((erro)=>{ console.error(erro); process.exit(1); });

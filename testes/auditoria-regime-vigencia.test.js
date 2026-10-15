'use strict';
const assert=require('node:assert/strict');
const { listar }=require('../src/services/auditoriaRegimeVigencia');
const cnpj='03773700004013';
const itens=[{movimento_id:7,cnpj,documento:'A',competencia:'2024-07',data_emissao:null,regime_fotografia:'imune_isento',versao_fotografia:0,regime_cadastro:'imune_isento'},{movimento_id:8,cnpj,documento:'B',competencia:'2025-07',data_emissao:null,regime_fotografia:'imune_isento',versao_fotografia:0,regime_cadastro:'imune_isento'},{movimento_id:9,cnpj,fornecedor:'Fornecedor de teste',valor:125.5,documento:'C',competencia:'2024-08',data_emissao:null,regime_fotografia:'lucro_real',versao_fotografia:0,regime_cadastro:'imune_isento'}];
const db={prepare(sql){return {get(){return sql.includes('motor_execucoes')?{id:99}:null;},all(){if(sql.includes('motor_resultados'))return itens;if(sql.includes('historico_regimes_parceiro'))return [];if(sql.includes('base_regime'))return [{cnpj:'03773700',raiz:'03773700',regime:'imune_isento',ano:2024,fonte:'Base RFB 2024'}];if(sql.includes('contraparte_regime_evidencias'))return [];throw new Error('Consulta inesperada: '+sql);}};}};
(async()=>{
const r=await listar(db,2);
assert.equal(r.execucao_id,99);
assert.equal(r.itens[0].status,'ATUAL','o parceiro vinculado deve ser a fonte canônica do documento');
assert.equal(r.itens[1].status,'ATUAL','o parceiro vinculado deve cobrir documentos posteriores sem nova busca');
assert.deepEqual(r.resumo,{total:3,atual:2,divergente:1,sem_historico:0});
assert.deepEqual(r.divergencias,[{cnpj,fornecedor:'Fornecedor de teste',regime_fotografia:['lucro_real'],regime_vigente:['imune_isento'],movimento_ids:[9],documentos:1,valor:125.5}], 'a seleção em lote deve conter somente documentos efetivamente divergentes');
assert.deepEqual(r.cobertura,[
  {ano:'2024',documentos:2,cnpjs:1,com_cobertura:2,sem_cobertura:0,fontes:[{fonte:'Parceiro vinculado ao documento',documentos:2}]},
  {ano:'2025',documentos:1,cnpjs:1,com_cobertura:1,sem_cobertura:0,fontes:[{fonte:'Parceiro vinculado ao documento',documentos:1}]},
],'a auditoria deve reutilizar o regime resolvido no vínculo do documento');
console.log('auditoria-regime-vigencia.test.js: OK');
})().catch((erro)=>{ console.error(erro); process.exit(1); });

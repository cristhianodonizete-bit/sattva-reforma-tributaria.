#!/usr/bin/env node
/* Regressão: a tela não pode manter uma nota autorizada se a fonte
   compartilhada já a marcou como cancelada. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-documentos-canonicos-'));

const db = require('../src/db');
db.prepare("INSERT INTO empresas (id,cnpj,razao_social) VALUES (1,'17796012000177','Relotec')").run();
db.prepare("INSERT INTO movimentos (id,empresa_id,tipo,sentido,documento,chave,competencia,valor,cfop,modelo_documento_fiscal,situacao_documento,origem) VALUES (10,1,'cliente','saida','1/21668','chave-21668','2026-04',2379.07,'5102','nfe','AUTORIZADO','xml')").run();

const remoto = {
  from(tabela) {
    if (tabela === 'empresas') return { select: () => ({ eq: () => ({ limit: async () => ({ data:[{ id:'empresa-remota', cnpj:'17796012000177', origem_local_id:1 }], error:null }) }) }) };
    if (tabela === 'movimentos') return { select: () => ({ eq: () => ({ range: async () => ({ data:[{
      id:10, empresa_id:'empresa-remota', tipo:'cliente', sentido:'saida', documento:'1/21668', chave:'chave-21668', competencia:'2026-04', valor:2379.07, cfop:'5102', modelo_documento_fiscal:'nfe', situacao_documento:'CANCELADO', cancelamento_origem:'QUESTOR_RELATORIO_CANCELADOS', origem:'xml',
    }], error:null }) }) }) };
    throw new Error(`Tabela inesperada: ${tabela}`);
  },
};
const caminhoSupabase=require.resolve('../src/services/supabase');
require.cache[caminhoSupabase]={exports:{configurado:()=>true,admin:()=>remoto}};
const operacao=require('../src/services/operacaoCompartilhada');

(async()=>{
  const primeira = await operacao.reconciliarMovimentosEmpresa(1);
  const documento=db.prepare('SELECT situacao_documento,cancelamento_origem FROM movimentos WHERE id=10').get();
  assert.equal(documento.situacao_documento,'CANCELADO');
  assert.equal(documento.cancelamento_origem,'QUESTOR_RELATORIO_CANCELADOS');
  // Simula uma sobra técnica com outro id local da mesma nota. O cache curto
  // deve continuar devolvendo a fotografia remota, nunca a tabela SQLite.
  db.prepare("INSERT INTO movimentos (id,empresa_id,tipo,sentido,documento,chave,competencia,valor,cfop,modelo_documento_fiscal,situacao_documento,origem) VALUES (99,1,'cliente','saida','1/21668','chave-21668','2026-04',2379.07,'5102','nfe','AUTORIZADO','xml')").run();
  const segunda = await operacao.reconciliarMovimentosEmpresa(1);
  assert.equal(primeira.movimentos.length,1);
  assert.equal(segunda.origem,'CACHE_CANONICO_RECENTE');
  assert.equal(segunda.movimentos.length,1);
  assert.equal(segunda.movimentos[0].situacao_documento,'CANCELADO');
  console.log('reconciliacao-documentos-canonicos.test: cache reflete somente a fotografia canônica.');
})().catch((erro)=>{ console.error(erro); process.exit(1); });

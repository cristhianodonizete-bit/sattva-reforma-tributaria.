#!/usr/bin/env node
/* Regressão: uma fotografia remota parcial não pode esconder o SPED que já
   foi importado localmente enquanto sua publicação está pendente. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-documentos-pendentes-'));
const db = require('../src/db');
db.prepare("INSERT INTO empresas (id,cnpj,razao_social) VALUES (1,'17796012000177','Empresa teste')").run();
db.prepare("INSERT INTO movimentos (id,empresa_id,tipo,sentido,documento,competencia,valor,cfop,origem) VALUES (10,1,'cliente','saida','NFe 10','2026-01',100,'5102','xml')").run();
db.prepare("INSERT INTO movimentos (id,empresa_id,tipo,sentido,documento,competencia,valor,cfop,origem) VALUES (20,1,'cliente','saida','Cupom 20','2026-01',50,'5102','sped')").run();

const remoto = {
  from(tabela) {
    if (tabela === 'empresas') return { select: () => ({ eq: () => ({ limit: async () => ({ data:[{ id:'empresa-remota', cnpj:'17796012000177', origem_local_id:1 }], error:null }) }) }) };
    if (tabela === 'movimentos') return { select: () => ({ eq: () => ({ range: async () => ({ data:[{
      id:10, empresa_id:'empresa-remota', tipo:'cliente', sentido:'saida', documento:'NFe 10', competencia:'2026-01', valor:100, cfop:'5102', origem:'xml',
    }], error:null }) }) }) };
    throw new Error(`Tabela inesperada: ${tabela}`);
  },
};
const caminhoSupabase = require.resolve('../src/services/supabase');
require.cache[caminhoSupabase] = { exports:{ configurado:() => true, admin:() => remoto } };
const operacao = require('../src/services/operacaoCompartilhada');

(async () => {
  const resultado = await operacao.reconciliarMovimentosEmpresa(1, { forcar:true });
  assert.match(resultado.origem, /COM_IMPORTACAO_LOCAL_PENDENTE/);
  assert.equal(resultado.movimentos.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM movimentos WHERE empresa_id=1').get().total, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM movimentos WHERE id=20').get().total, 1);
  console.log('reconciliacao-documentos-importacao-local-pendente.test: SPED local preservado ao reconciliar fotografia parcial.');
})().catch((erro) => { console.error(erro); process.exit(1); });

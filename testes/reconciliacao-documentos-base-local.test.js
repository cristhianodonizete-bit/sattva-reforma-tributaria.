#!/usr/bin/env node
/* Regressão: uma instalação sem fonte compartilhada ainda deve exibir os
   documentos que ela própria acabou de importar, sem pedir nova importação. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-documentos-local-'));
process.env.SUPABASE_OPERACAO_COMPARTILHADA = 'false';
delete process.env.SUPABASE_DB_URL;

const db = require('../src/db');
db.prepare("INSERT INTO empresas (id,cnpj,razao_social) VALUES (1,'17796012000177','Empresa local')").run();
db.prepare("INSERT INTO movimentos (empresa_id,tipo,sentido,documento,competencia,valor,cfop,origem) VALUES (1,'cliente','saida','1','2026-01',100,'5102','xml')").run();
const operacao = require('../src/services/operacaoCompartilhada');

(async () => {
  const resultado = await operacao.reconciliarMovimentosEmpresa(1, { forcar:true });
  assert.equal(resultado.origem, 'BASE_LOCAL_PERSISTIDA');
  assert.equal(resultado.movimentos.length, 1);
  assert.equal(resultado.movimentos[0].valor, 100);
  console.log('reconciliacao-documentos-base-local.test: documentos locais persistidos são exibidos sem fonte compartilhada.');
})().catch((erro) => { console.error(erro); process.exit(1); });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-pgdas-indice-'));
const db = require('../src/db');
const indice = require('../src/services/pgdasIndiceSerpro');
const empresa = db.prepare("INSERT INTO empresas (razao_social,cnpj,regime) VALUES ('Teste','17796012000177','simples_nacional')").run();
const retorno = { dados:{ anoCalendario:2026, periodos:[{ periodoApuracao:202606, operacoes:[
  { tipoOperacao:'Original', indiceDeclaracao:{ numeroDeclaracao:'17796012202606001', dataHoraTransmissao:'20260720102337', malha:'' }, indiceDas:null },
  { tipoOperacao:'Geração de DAS', indiceDeclaracao:null, indiceDas:{ numeroDas:'07202620144270900', datahoraEmissaoDas:'20260720102359', dasPago:true } },
] }] } };
const l = indice.persistir(db, Number(empresa.lastInsertRowid), retorno, '2026-06');
assert.equal(l.length, 1);
assert.equal(l[0].declaracoes.length, 1);
assert.equal(l[0].das.length, 1);
const ap = db.prepare('SELECT * FROM pgdas_apuracoes_serpro WHERE empresa_id=?').get(empresa.lastInsertRowid);
assert.deepEqual([ap.status_declaracao, ap.status_das, ap.status_pagamento], ['TRANSMITIDA','GERADO','PAGO']);
assert.equal(db.prepare('SELECT COUNT(*) c FROM pgdas_declaracoes_serpro').get().c, 1);
assert.equal(db.prepare('SELECT COUNT(*) c FROM pgdas_das_serpro').get().c, 1);
indice.persistir(db, Number(empresa.lastInsertRowid), retorno, '2026-06');
assert.equal(db.prepare('SELECT COUNT(*) c FROM pgdas_operacoes_serpro').get().c, 2, 'reprocessamento não duplica operações');
console.log('pgdas-indice-serpro.test.js: OK');

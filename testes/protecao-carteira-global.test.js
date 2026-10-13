#!/usr/bin/env node
/* A barreira deve falhar antes de a leitura global virar OOM. */
const assert=require('node:assert/strict');
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-protecao-carteira-')); process.env.SATTVA_DADOS=dir;
const db=require('../src/db');
const empresa=Number(db.prepare("INSERT INTO empresas(cnpj,razao_social) VALUES('99000000000001','Proteção')").run().lastInsertRowid);
db.prepare("INSERT INTO movimentos(empresa_id,tipo,valor) VALUES(?,'fornecedor',1)").run(empresa);
assert.throws(()=>db.prepare('SELECT * FROM movimentos WHERE empresa_id=?').all(empresa),{code:'LEITURA_GLOBAL_PROIBIDA'});
assert.equal(db.prepare('SELECT id FROM movimentos WHERE empresa_id=? ORDER BY id LIMIT ?').all(empresa,100).length,1);
assert.equal(db.prepare('SELECT COUNT(*) quantidade FROM movimentos WHERE empresa_id=?').get(empresa).quantidade,1);
assert.equal(db.prepare('SELECT id FROM movimentos WHERE empresa_id=? AND id IN (?)').all(empresa,1).length,1);
console.log('protecao-carteira-global.test: leitura global bloqueada; página, agregado e IDs explícitos permitidos.');
try{db.close?.()}catch(_){} fs.rmSync(dir,{recursive:true,force:true});

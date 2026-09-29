const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-pgdas-restauracao-'));
process.env.SATTVA_DADOS = pasta;
const db = require('../src/db');
const pgdas = require('../src/services/pgdasCompartilhado');
const empresaId = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('00000000000223','Teste PGDAS','simples_nacional')").run().lastInsertRowid);

const anterior = db.prepare(`INSERT INTO pgdas_documentos
  (empresa_id,nome_original,tipo_documento,conteudo_original,hash_sha256,competencia_detectada,data_processamento,metodo_extracao,status_processamento)
  VALUES (?,?,?,?,?,?,?,?,?)`).run(empresaId, 'declaracao-antiga.pdf', 'INTEGRA_CONTADOR_PDF', Buffer.from('pdf-antigo'), 'hash-antigo', '2026-04', '2026-01-01T00:00:00Z', 'ANTERIOR', 'VALIDADO_USUARIO');
db.prepare(`INSERT INTO pgdas_documento_campos (documento_id,campo,valor_extraido,metodo_extracao,status_validacao)
  VALUES (?,?,?,?,?)`).run(anterior.lastInsertRowid, 'pis', '537.74', 'ANTERIOR', 'VALIDADO_USUARIO');

const remoto = { id:99, nome_original:'declaracao-confirmada.pdf', tipo_documento:'INTEGRA_CONTADOR_PDF', mime_type:'application/pdf', conteudo_original:Buffer.from('pdf'), hash_sha256:'hash-confirmado', competencia_detectada:'2026-04', data_processamento:'2026-09-28T00:00:00Z', metodo_extracao:'OFICIAL', status_processamento:'VALIDADO_USUARIO' };
pgdas.aplicarRestauracao(empresaId, [remoto], new Map([[99, [{ campo:'pis', valor_extraido:'531.07', rotulo_original:'PIS', pagina_ou_localizacao:null, confianca:1, metodo_extracao:'OFICIAL', status_validacao:'VALIDADO_USUARIO' }]]]));

const documentos = db.prepare('SELECT * FROM pgdas_documentos WHERE empresa_id=? AND competencia_detectada=? ORDER BY id DESC').all(empresaId, '2026-04');
assert.equal(documentos.length, 1, 'a versão oficial deve substituir o cache local da mesma competência, sem duplicá-la');
assert.equal(documentos[0].hash_sha256, 'hash-confirmado');
assert.equal(documentos[0].nome_original, 'declaracao-confirmada.pdf');
assert.equal(db.prepare('SELECT valor_extraido FROM pgdas_documento_campos WHERE documento_id=? AND campo=?').get(documentos[0].id, 'pis').valor_extraido, '531.07');
console.log('pgdas-compartilhado-restauracao: fonte confirmada prevalece sobre cache da mesma competência: OK');
db.close();
fs.rmSync(pasta, { recursive:true, force:true });

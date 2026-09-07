const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-auditoria-matriz-'));
const db = require('../src/db');
const refs = require('../src/services/referenciasFiscaisOficiais');
const { auditar } = require('../src/services/auditoriaMatrizFiscal');

const ncm = refs.registrarReferencia({ dominio: 'NCM', codigo: '01012100', descricao: 'Referência NCM', fonte: 'Fonte oficial', versao_fonte: 'v1', hash_origem: 'a'.repeat(64) });
const nbs = refs.registrarReferencia({ dominio: 'NBS', codigo: '115013000', descricao: 'Suporte', fonte: 'Fonte oficial', versao_fonte: 'v1', hash_origem: 'b'.repeat(64) });
const lc = refs.registrarReferencia({ dominio: 'LC116', codigo: '0107', descricao: 'Suporte técnico', fonte: 'Fonte oficial', versao_fonte: 'v1', hash_origem: 'c'.repeat(64) });
refs.registrarRelacaoNbsLc116({ nbs, lc116: lc, fonte: 'Correlação oficial', vigencia_inicio: '2026-01-01' });
db.prepare(`INSERT INTO base_ncm (ncm,descricao) VALUES ('01012100','Válido'),('99999999','Sem referência')`).run();
db.prepare(`INSERT INTO base_servicos (nbs,lc116,descricao_item) VALUES ('115013000','0107','Válido'),('999999999','0107','Marcador interno')`).run();

const resultado = auditar({ db });
assert.equal(resultado.catalogo_operacional.ncm.chaves_sem_referencia, 1);
assert.deepEqual(resultado.catalogo_operacional.ncm.sem_referencia[0], { codigo: '99999999', linhas: 1 });
assert.equal(resultado.catalogo_operacional.nbs.chaves_sem_referencia, 1);
assert.equal(resultado.catalogo_operacional.pares_nbs_lc116.pares_sem_relacao_oficial, 1);
assert.equal(resultado.catalogo_operacional.pares_nbs_lc116.sem_relacao_oficial[0].motivo, 'NBS_NAO_IDENTIFICADA');
assert.equal(resultado.governanca_fontes.estado, 'RASTREAVEL');

console.log('auditoria-matriz-operacional-referencias: cobertura de chaves e proveniência validada');
db.close();
fs.rmSync(process.env.SATTVA_DADOS, { recursive: true, force: true });

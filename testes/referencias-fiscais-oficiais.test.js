const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-referencias-'));
process.env.SATTVA_DADOS = dados;
const db = require('../src/db');
const refs = require('../src/services/referenciasFiscaisOficiais');

assert.equal(refs.normalizarNcm('01.02.90.00'), '01029000');
assert.equal(refs.normalizarNbs('1.1501.30.00'), '115013000');
assert.equal(refs.normalizarLc116('1.07'), '0107');

assert.throws(() => refs.registrarReferencia({ dominio: 'NCM', codigo: '01029000' }), /Fonte oficial/);
assert.throws(() => refs.registrarReferencia({ dominio: 'NBS', codigo: '', fonte: 'Teste' }), /inválido/);

const ncm = refs.registrarReferencia({ dominio: 'NCM', codigo: '01.02.90.00', descricao: 'Outros', fonte: 'RFB', versao_fonte: '2026-02' });
assert.equal(ncm.criado, true);
assert.equal(refs.registrarReferencia({ dominio: 'NCM', codigo: '01029000', descricao: 'Outro texto não substitui a fonte', fonte: 'RFB', versao_fonte: '2026-02' }).criado, false);
assert.equal(refs.consultar({ ncm: '01029000' }).length, 1);

const relacao = refs.registrarRelacaoNbsLc116({
  nbs: { codigo: '1.1501.30.00', descricao: 'Suporte de TI', fonte: 'NBS oficial', versao_fonte: '2026' },
  lc116: { codigo: '1.07', descricao: 'Suporte técnico', fonte: 'LC 116', versao_fonte: '2003' },
  fonte: 'Correlação oficial', evidencia: 'Anexo de correlação',
});
assert.equal(relacao.criado, true);

console.log('referencias-fiscais-oficiais: normalização e proteção de fonte validadas');
db.close();
fs.rmSync(dados, { recursive: true, force: true });

const assert = require('assert');
const zlib = require('zlib');
const contratos = require('../src/services/contratosEntrega1');

const completo = `CLÁUSULA 1 — PREÇO E TRIBUTOS
O preço poderá ser reajustado anualmente pelo IPCA. Havendo alteração legislativa tributária, inclusive IBS e CBS, as partes poderão promover reequilíbrio econômico-financeiro e repasse tributário mediante documentação fiscal.

CLÁUSULA 2 — RESPONSABILIDADES
Cada parte responde por suas obrigações tributárias e retenções, emitindo o documento fiscal aplicável.

CLÁUSULA 3 — VIGÊNCIA
O contrato terá vigência de 12 meses, com renovação por escrito e rescisão mediante aviso prévio.`;

const pendente = `CLÁUSULA 1 — PREÇO
O preço é fixo e irreajustável durante toda a vigência. A contratada responderá pelos impostos incidentes.`;

const r1 = contratos.analisarTexto(completo);
assert(r1.clausulas.some((c) => c.tema === 'reequilibrio'));
assert(r1.clausulas.some((c) => c.tema === 'repasse_tributario'));
assert(r1.clausulas.some((c) => c.tema === 'responsabilidade_tributaria'));
assert(!r1.riscos.some((r) => r.codigo === 'AUSENCIA_CLAUSULA_TRIBUTARIA'));

const r2 = contratos.analisarTexto(pendente);
assert(r2.riscos.some((r) => r.codigo === 'PRECO_FIXO_SEM_REVISAO'));
assert(r2.riscos.some((r) => r.codigo === 'POTENCIAL_ABSORCAO_AUMENTO'));
assert(r2.riscos.some((r) => r.codigo === 'SEM_GATILHO_ALTERACAO_LEGAL'));
assert(r2.riscos.every((r) => r.natureza === 'INTERPRETADO' && r.evidencia));

// DOCX isolado: ZIP mínimo com word/document.xml, sem depender de arquivo real.
function zipStore(nome, texto) {
  const dados = Buffer.from(texto); const nomeB = Buffer.from(nome); const local = Buffer.alloc(30 + nomeB.length + dados.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14); local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(nomeB.length, 26); local.writeUInt16LE(0, 28); nomeB.copy(local, 30); dados.copy(local, 30 + nomeB.length);
  const central = Buffer.alloc(46 + nomeB.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt32LE(0, 16); central.writeUInt32LE(dados.length, 20); central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(nomeB.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt32LE(0, 42); nomeB.copy(central, 46);
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10); fim.writeUInt32LE(central.length, 12); fim.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, fim]);
}
const docx = zipStore('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Preço e tributos</w:t></w:r></w:p></w:body></w:document>');
assert(contratos.textoDocx(docx).includes('Preço e tributos'));
assert.strictEqual(contratos.hash(Buffer.from('original')), contratos.hash(Buffer.from('original')));

console.log('Contratos Entrega 1: 3 cenários determinísticos aprovados.');

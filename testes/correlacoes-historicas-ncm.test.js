const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-correlacao-ncm-'));
process.env.SATTVA_DADOS = dir;
const db = require('../src/db');
const { importarArquivo, resolver } = require('../src/services/correlacoesHistoricasNcm');

const arquivo = path.join(dir, 'correlacoes.json');
fs.writeFileSync(arquivo, JSON.stringify({ hash_arquivo: 'arquivo', relacoes: [
  { codigo_origem: '30021900', codigo_destino: '30021590', tipo_relacao: 'DIRETA', versao_origem: 'NCM 2017', versao_destino: 'NCM 2022', fonte: 'MDIC', hash_origem: 'a'.repeat(64), evidencia: 'página 1' },
  { codigo_origem: '04100000', codigo_destino: '04101000', tipo_relacao: 'PARCIAL_EX', versao_origem: 'NCM 2017', versao_destino: 'NCM 2022', fonte: 'MDIC', hash_origem: 'a'.repeat(64), evidencia: 'página 2' },
  { codigo_origem: '04100000', codigo_destino: '04109000', tipo_relacao: 'PARCIAL_EX', versao_origem: 'NCM 2017', versao_destino: 'NCM 2022', fonte: 'MDIC', hash_origem: 'a'.repeat(64), evidencia: 'página 2' },
] }));
assert.equal(importarArquivo({ arquivo, db }).aplicado, false);
assert.equal(importarArquivo({ arquivo, aplicar: true, db }).inseridas, 3);
assert.equal(importarArquivo({ arquivo, aplicar: true, db }).inseridas, 0);
assert.deepEqual(resolver({ ncm: '30021900', db }).codigo_resolvido, '30021590');
assert.equal(resolver({ ncm: '04100000', db }).status, 'PENDENTE_CORRELACAO_NAO_UNIVOCA');

console.log('correlacoes-historicas-ncm: importação idempotente e resolução segura validadas');
db.close();
fs.rmSync(dir, { recursive: true, force: true });

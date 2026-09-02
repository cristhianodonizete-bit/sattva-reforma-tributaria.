#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-gestao-cache-'));
const { mapaEmpresasLocais, normalizarEmpresaIdDoCache } = require('../src/services/operacaoCompartilhada');

const mapa = mapaEmpresasLocais([
  { id: '739b329a-06c7-49e4-a0e7-4c1075645bd8', origem_local_id: 1 },
  { id: '5b8d7cf1-bb80-47cc-86cb-2e8c97b2ba85', origem_local_id: 27 },
]);

assert.equal(mapa.get('739b329a-06c7-49e4-a0e7-4c1075645bd8'), 1);
assert.equal(mapa.get('5b8d7cf1-bb80-47cc-86cb-2e8c97b2ba85'), 27);
assert.equal(mapa.has('empresa-invalida'), false);
assert.deepEqual(
  normalizarEmpresaIdDoCache('empresa_qsa', [{ id: 'socio-remoto', empresa_id: '739b329a-06c7-49e4-a0e7-4c1075645bd8', nome: 'Sócio' }], mapa),
  [{ id: 'socio-remoto', empresa_id: 1, nome: 'Sócio' }],
  'QSA remoto deve ser associado à empresa local antes de gravar o cache',
);
const fonteOperacao = fs.readFileSync(path.join(__dirname, '../src/services/operacaoCompartilhada.js'), 'utf8');
const fonteApi = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
assert.match(fonteOperacao, /ativo: true, execucao_id: x\.execucao_id/, 'nova fotografia deve ser publicada como ativa');
assert.match(fonteOperacao, /empresasDaFotografia/, 'publicação deve tratar a fotografia completa de cada empresa');
assert.match(fonteOperacao, /update\(\{ ativo: false \}\).*eq\('empresa_id', idEmpresa\)\.eq\('ativo', true\)/s,
  'fotografia anterior deve ser desativada antes de ativar a substituta');
assert.match(fonteApi, /await require\('\.\.\/services\/operacaoCompartilhada'\)\.publicarResultadosMotor\(Number\(req\.params\.id\)\)/,
  'recalcular motor deve aguardar a publicação compartilhada');
console.log('operacao-compartilhada-gestao: UUID remoto e fotografia ativa: OK');

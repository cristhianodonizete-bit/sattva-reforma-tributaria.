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
console.log('operacao-compartilhada-gestao: UUID remoto mapeado ao ID local: OK');

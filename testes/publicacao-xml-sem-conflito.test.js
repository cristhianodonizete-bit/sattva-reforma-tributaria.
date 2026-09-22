#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-publicacao-xml-'));
const { deduplicarXmlParaPublicacao } = require('../src/services/operacaoCompartilhada');

const linhas = [
  { id: 10, empresa_id: 23, chave: '31702062217796012000177000000000000126012514581321', item_numero: 1, valor: 4794.14 },
  { id: 11, empresa_id: 23, chave: '31702062217796012000177000000000000126012514581321', item_numero: 1, valor: 4794.14 },
  { id: 12, empresa_id: 23, chave: '31702062217796012000177000000000000126012514581321', item_numero: 2, valor: 100 },
];

const unicas = deduplicarXmlParaPublicacao(linhas);
assert.equal(unicas.length, 2, 'cada chave fiscal + item deve ser enviada uma única vez');
assert.equal(unicas.find((linha) => linha.item_numero === 1).id, 11, 'a versão mais recente é usada no envio');
assert.equal(linhas.length, 3, 'a consolidação de envio não apaga registros locais');
console.log('publicacao-xml-sem-conflito.test: XML repetido é consolidado apenas no envio remoto.');

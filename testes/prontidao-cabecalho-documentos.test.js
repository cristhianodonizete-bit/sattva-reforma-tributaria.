#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tela = fs.readFileSync(path.join(__dirname, '../public/js/telas.js'), 'utf8');
assert.match(
  tela,
  /const consultaProntidao = consultaDocumentos \|\| consultaDadosAdicionais \|\| consultaApuracoes \|\| grupoCentral === 'dashboard';/,
  'o selo de Pendências em Documentos fiscais precisa carregar a prontidão que ele abre',
);
assert.match(tela, /data-prontidao/, 'o acionador do selo de prontidão deve continuar presente');
console.log('prontidao-cabecalho-documentos.test: selo de Pendências possui dados para abrir a modal.');

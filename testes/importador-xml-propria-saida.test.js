const assert = require('assert');
const { lerXml } = require('../src/services/importadorXml');

const xml = `<nfeProc><NFe><infNFe Id="NFe31260437630286000107550010000075991601723231">
  <ide><serie>1</serie><nNF>7599</nNF><dhEmi>2026-04-01T17:16:04-03:00</dhEmi><tpNF>1</tpNF><natOp>Baixa de estoque decorrente de perda</natOp></ide>
  <emit><CNPJ>37630286000107</CNPJ><xNome>VL DISTRIBUIDORA</xNome><enderEmit><UF>MG</UF></enderEmit></emit>
  <dest><CNPJ>37630286000107</CNPJ><xNome>VL DISTRIBUIDORA</xNome><enderDest><UF>MG</UF></enderDest></dest>
  <total><ICMSTot><vNF>976.80</vNF></ICMSTot></total>
  <det nItem="1"><prod><cProd>6533</cProd><xProd>Água</xProd><CFOP>5927</CFOP><vProd>976.80</vProd></prod><imposto/></det>
</infNFe></NFe></nfeProc>`;

const documento = lerXml(xml, '37630286000107');
assert.equal(documento.sentido, 'saida');
assert.equal(documento.itens.length, 1);
assert.equal(documento.itens[0].sentido, 'saida');
assert.equal(documento.itens[0].tipo, 'cliente');
assert.equal(documento.itens[0].cfop, '5927');
console.log('importador-xml-propria-saida.test.js: OK');


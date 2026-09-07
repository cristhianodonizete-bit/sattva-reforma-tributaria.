const assert = require('assert');
const documentos = require('../src/config/conhecimentoFiscalOficial');

assert.equal(documentos.length, 5, 'A curadoria oficial deve conter as cinco referências mínimas.');
for (const documento of documentos) {
  assert.ok(documento.titulo && documento.fonte && documento.categoria && documento.conteudo,
    `Documento incompleto: ${documento.titulo || '(sem título)'}`);
  if (documento.categoria !== 'governanca_interna') {
    assert.ok(/^https?:\/\//.test(documento.fonte.match(/https?:\/\/[^\s;]+/)?.[0] || ''),
      `A fonte precisa conter URL: ${documento.titulo}`);
  }
}
assert.ok(documentos.some((d) => d.categoria === 'legislacao_oficial_pis_cofins'));
assert.ok(documentos.some((d) => d.categoria === 'legislacao_oficial_reforma'));
assert.ok(documentos.some((d) => d.categoria === 'documentos_fiscais_oficiais'));
assert.ok(documentos.some((d) => d.categoria === 'governanca_interna'));
console.log('conhecimento-fiscal-oficial: curadoria oficial e contrato operacional aprovados.');

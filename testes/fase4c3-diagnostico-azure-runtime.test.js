const assert = require('assert');
const azure = require('../src/services/azureDocumentIntelligence');

const ambienteAnterior = {
  endpoint: process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
  key: process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
};
function restaurar(nome, valor) {
  if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
}

try {
  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = '  https://recurso.cognitiveservices.azure.com/  ';
  process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = '  chave-teste  ';
  let d = azure.diagnosticoSeguro();
  assert.deepStrictEqual(d, {
    endpoint_configurado: true, key_configurada: true, endpoint_valido: true,
    azure_configurado: true, motivo_inativo: null,
  });
  assert.strictEqual(azure.config().endpoint, 'https://recurso.cognitiveservices.azure.com');
  assert.strictEqual(azure.config().key, 'chave-teste');

  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = '   ';
  d = azure.diagnosticoSeguro();
  assert.strictEqual(d.azure_configurado, false);
  assert.strictEqual(d.motivo_inativo, 'AZURE_ENDPOINT_AUSENTE');

  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = 'http://invalido';
  d = azure.diagnosticoSeguro();
  assert.strictEqual(d.azure_configurado, false);
  assert.strictEqual(d.motivo_inativo, 'AZURE_ENDPOINT_INVALIDO');
} finally {
  restaurar('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', ambienteAnterior.endpoint);
  restaurar('AZURE_DOCUMENT_INTELLIGENCE_KEY', ambienteAnterior.key);
}
console.log('Diagnóstico Azure runtime: booleanos seguros, trim e endpoint válido verificados.');

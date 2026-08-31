const assert = require('assert');
const fs = require('fs');
const fonte = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const identifica = fonte.indexOf('const preparados = arquivos.map');
const criaLote = fonte.indexOf('const lote = db.prepare', identifica);
assert.ok(identifica >= 0, 'arquivos são identificados antes do processamento');
assert.ok(criaLote > identifica, 'lote é criado somente após a identificação');
assert.ok(fonte.includes('sped.lerSped(arquivo.buffer, empresa.cnpj)'), 'parser existente é reutilizado na pré-validação');
console.log('etapa3e2a2a-ordem-upload-sped.test: ordem de identificação aprovada');

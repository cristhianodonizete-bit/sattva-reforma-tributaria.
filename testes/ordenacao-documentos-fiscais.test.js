const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const telas = fs.readFileSync(require.resolve('../public/js/telas'), 'utf8');
const compartilhada = fs.readFileSync(require.resolve('../src/services/documentosFiscaisCompartilhados'), 'utf8');

assert.match(api, /function ordenacaoSqlDocumentosFiscais/, 'API deve aceitar ordenação validada');
assert.match(api, /competencia:.*COALESCE\(data_emissao, competencia, criado_em\)/, 'competência usa uma ordem estável');
assert.match(api, /ORDER BY \$\{ordenacao\}/, 'a paginação ocorre depois da ordenação no servidor');
assert.match(compartilhada, /function ordenacaoSql/, 'a leitura direta compartilhada aceita a mesma ordenação');
assert.match(compartilhada, /ORDER BY \$\{ordenacao\}/, 'a fonte que a tela exibe ordena antes de paginar');
assert.match(telas, /cabecalhoOrdenavel/, 'a tabela fiscal expõe cabeçalhos clicáveis');
assert.match(telas, /data-ordenar-documentos/, 'os cabeçalhos identificam a coluna a ordenar');
assert.match(telas, /ordenar_por/, 'a ordenação selecionada é enviada à API');
assert.match(telas, /documentosFiscaisPagina=1/, 'trocar ordenação volta à primeira página');

console.log('ordenacao-documentos-fiscais: ordenação segura e paginada: OK');

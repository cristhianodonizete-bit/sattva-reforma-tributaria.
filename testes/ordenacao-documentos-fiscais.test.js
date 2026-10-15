const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const telas = fs.readFileSync(require.resolve('../public/js/telas'), 'utf8');
const compartilhada = fs.readFileSync(require.resolve('../src/services/documentosFiscaisCompartilhados'), 'utf8');
const { ordenarDocumentos } = require('../src/services/ordenacaoDocumentosFiscais');

assert.match(api, /function ordenacaoSqlDocumentosFiscais/, 'API deve aceitar ordenação validada');
assert.match(api, /competencia:.*COALESCE\(data_emissao, competencia, criado_em\)/, 'competência usa uma ordem estável');
assert.match(api, /ORDER BY \$\{ordenacao\}/, 'a paginação ocorre depois da ordenação no servidor');
assert.match(compartilhada, /function ordenacaoSql/, 'a leitura direta compartilhada aceita a mesma ordenação');
assert.match(compartilhada, /ORDER BY \$\{ordenacao\}/, 'a fonte que a tela exibe ordena antes de paginar');
assert.match(telas, /cabecalhoOrdenavel/, 'a tabela fiscal expõe cabeçalhos clicáveis');
assert.match(telas, /data-ordenar-documentos/, 'os cabeçalhos identificam a coluna a ordenar');
assert.match(telas, /ordenar_por/, 'a ordenação selecionada é enviada à API');
assert.match(telas, /documentosFiscaisPagina=1/, 'trocar ordenação volta à primeira página');
assert.doesNotMatch(api, /mesclarEPaginarDocumentos\(/, 'pendências não podem ser mescladas à lista paginada');
assert.match(api, /entradas_questor_pendencias:entradasOutbox\.resumoPendencias\(empresaId\)/, 'pendências devem ficar no resumo próprio');
assert.match(api, /ordenar_por:req\.query\.ordenar_por, ordem:req\.query\.ordem/, 'a contingência local recebe a ordenação da tela');

const documentosFiscais = [
  { referencia:'xml:2', item_id:2, valor:14319.32 },
  { referencia:'xml:1', item_id:1, valor:2375 },
  { referencia:'xml:3', item_id:3, valor:4620.75 },
];
const pendenciasForaDaLista = [
  { referencia:'questor:1', origem:'QUESTOR_CONCILIACAO_ENTRADA', valor:3733 },
  { referencia:'razao-previa:2', origem:'QUESTOR_RAZAO', valor:2500 },
];
const pagina = ordenarDocumentos(documentosFiscais, { ordenar_por:'valor', ordem:'DESC' });
assert.deepEqual(pagina.map((d) => d.valor), [14319.32, 4620.75, 2375], 'documentos fiscais continuam ordenados por valor');
assert.equal(pagina.length, 3, 'total e paginação contam somente documentos fiscais');
assert.equal(pagina.some((d) => /QUESTOR|razao-previa/i.test(String(d.origem || '') + String(d.referencia || ''))), false, 'pendências não entram na lista paginada');
assert.equal(pendenciasForaDaLista.length, 2, 'pendências permanecem disponíveis exclusivamente no bloco próprio');
console.log('ordenacao-documentos-fiscais: ordenação segura e paginada: OK');

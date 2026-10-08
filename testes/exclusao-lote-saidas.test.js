const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const telas = fs.readFileSync(require.resolve('../public/js/telas'), 'utf8');
const inicio = api.indexOf("router.post('/empresas/:id/documentos-fiscais/excluir-lote'");
const fim = api.indexOf("router.get('/empresas/:id/documentos-fiscais/:referencia'", inicio);
const bloco = api.slice(inicio, fim);

assert.ok(inicio >= 0 && fim > inicio, 'rota de exclusão em lote deve existir antes da rota genérica por referência');
assert.match(bloco, /filtrosDocumentosFiscaisAtivos/, 'lote exige ao menos um filtro ativo');
assert.match(api, /function documentosFiscaisDeSaidaPorFiltro[\s\S]*sentido:'cliente'/, 'a resolução do lote força exclusivamente documentos de saída');
assert.match(bloco, /excluirDocumentoFiscalCanonico/, 'a fonte canônica é removida antes da cópia local');
assert.match(bloco, /DOCUMENTOS_FISCAIS_SAIDA_EXCLUIDOS_EM_LOTE/, 'a operação em lote fica auditável');
assert.match(bloco, /estadoLeituraEmpresa\.invalidar/, 'a leitura e as análises afetadas são invalidadas');
assert.match(telas, /excluirDocumentosSaidaFiltrados/, 'a aba de saídas oferece a ação em lote');
assert.match(telas, /demais páginas/, 'a confirmação esclarece que o lote não se limita à página visível');
assert.match(telas, /abaDocumentosFiscais === 'saidas' && filtrosDocumentosAtivos/, 'o botão só aparece em saídas quando há filtro');

console.log('exclusao-lote-saidas: filtro, fonte canônica, auditoria e interface: OK');

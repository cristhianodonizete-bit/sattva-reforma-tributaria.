const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const telas = fs.readFileSync(require.resolve('../public/js/telas'), 'utf8');
const compartilhada = fs.readFileSync(require.resolve('../src/services/operacaoCompartilhada'), 'utf8');
const inicio = api.indexOf("router.post('/empresas/:id/documentos-fiscais/excluir-lote'");
const fim = api.indexOf("router.get('/empresas/:id/documentos-fiscais/:referencia'", inicio);
const bloco = api.slice(inicio, fim);

assert.ok(inicio >= 0 && fim > inicio, 'rota de exclusão em lote deve existir antes da rota genérica por referência');
assert.match(bloco, /filtrosDocumentosFiscaisAtivos/, 'lote exige ao menos um filtro ativo');
assert.match(bloco, /documentosFiscaisCompartilhados.*listar/, 'o lote resolve o conjunto na mesma fonte canônica lida pela tela');
assert.match(bloco, /sentido:'cliente'/, 'a resolução do lote força exclusivamente documentos de saída');
assert.match(bloco, /excluirDocumentoFiscalCanonico/, 'a fonte canônica é removida antes da cópia local');
assert.match(bloco, /chaves, movimentoIds:idsCanonicos/, 'IDs canônicos não são substituídos por IDs do cache local');
assert.match(compartilhada, /\{ chave = null, chaves = \[\], movimentoIds = \[\] \}/, 'a exclusão canônica aceita um conjunto de chaves fiscais');
assert.match(compartilhada, /erroExcluir[\s\S]*invalidarReconciliacaoMovimentosEmpresa\(empresaId\)/, 'excluir documento derruba a reconciliação em memória');
assert.match(api, /Perfil Tributário[\s\S]*maxAgeMs:0/, 'a auditoria mensal sempre confere os documentos na fonte atual');
assert.match(bloco, /DOCUMENTOS_FISCAIS_SAIDA_EXCLUIDOS_EM_LOTE/, 'a operação em lote fica auditável');
assert.match(bloco, /estadoLeituraEmpresa\.invalidar/, 'a leitura e as análises afetadas são invalidadas');
assert.match(telas, /excluirDocumentosSaidaFiltrados/, 'a aba de saídas oferece a ação em lote');
assert.match(telas, /demais páginas/, 'a confirmação esclarece que o lote não se limita à página visível');
assert.match(telas, /abaDocumentosFiscais === 'saidas'/, 'o botão aparece somente na aba de saídas');
assert.match(telas, /Aplique um filtro para excluir em lote/, 'sem filtro, a interface explica por que a ação está desativada');

console.log('exclusao-lote-saidas: filtro, fonte canônica, auditoria e interface: OK');

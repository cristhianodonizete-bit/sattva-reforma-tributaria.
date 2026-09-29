const assert = require('node:assert/strict');
const fs = require('node:fs');

const leitor = fs.readFileSync(require.resolve('../src/services/documentosFiscaisCompartilhados'), 'utf8');
const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');
const rotaNormal = api.slice(api.indexOf("router.get('/empresas/:id/documentos-fiscais'"), api.indexOf("router.get('/empresas/:id/documentos-fiscais/exportar'"));
const rotaSombra = api.slice(api.indexOf("router.get('/empresas/:id/documentos-fiscais/sombra-compartilhada'"), api.indexOf("router.get('/empresas/:id/documentos-fiscais/:referencia'"));

assert.match(leitor, /BEGIN READ ONLY/, 'leitor direto abre transação somente leitura');
assert.match(leitor, /ROLLBACK/, 'leitor direto encerra a leitura sem persistir mudanças');
assert.doesNotMatch(leitor, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i, 'leitor direto não contém comandos de escrita ou estrutura');
assert.match(leitor, /m\.competencia=\$2/, 'competência é aplicada antes da deduplicação');
assert.match(rotaSombra, /garantirEmpresaPermitida/, 'rota sombra exige sessão autorizada');
assert.match(rotaSombra, /documentosFiscaisCompartilhados/, 'rota sombra usa leitor isolado');
assert.match(rotaNormal, /reconciliarDocumentosFiscaisParaLeitura/, 'rota normal permanece inalterada durante a comparação');
assert.match(api, /LEITURA_DOCUMENTOS_COMPARTILHADA_ATIVA === 'true'/, 'leitura direta exige ativação explícita');
assert.match(api, /LEITURA_DOCUMENTOS_COMPARTILHADA_EMPRESA_ID/, 'ativação é limitada a uma empresa');
assert.match(api, /LEITURA_DOCUMENTOS_COMPARTILHADA_COMPETENCIA/, 'ativação é limitada a uma competência');

console.log('leitura-documentos-compartilhada-sombra: isolamento e contrato somente-leitura: OK');

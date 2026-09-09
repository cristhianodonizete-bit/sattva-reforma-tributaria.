const assert = require('node:assert/strict');
const { montarAuditoriaMensal } = require('../src/services/perfilTributarioHistorico');

const auditoria = montarAuditoriaMensal(
  [
    { competencia:'2026-01', receita_documentada:1000, quantidade_documentos:2 },
    { competencia:'2026-02', receita_documentada:800, quantidade_documentos:1 },
  ],
  [
    { competencia:'2026-01', receita_base:1000, nome_original:'pis-jan.pdf', status_validacao:'VALIDADO_USUARIO' },
    { competencia:'2026-02', receita_base:750, nome_original:'pis-fev.pdf', status_validacao:'VALIDADO_AUTOMATICAMENTE' },
  ],
  [
    { competencia:'2026-03', receita_bruta:500, origem:'pgdas_importado' },
    { competencia:'2026-04', receita_bruta:null, origem:'pgdas_azure_confirmado' },
  ],
);

assert.deepEqual(auditoria.map((x) => x.competencia), ['2026-01', '2026-02', '2026-03', '2026-04']);
assert.equal(auditoria[0].situacao, 'CONCILIADO');
assert.equal(auditoria[1].situacao, 'DIVERGENCIA_A_CONFERIR');
assert.equal(auditoria[1].diferencas[0].valor, -50);
assert.equal(auditoria[2].situacao, 'SEM_DOCUMENTOS_DE_RECEITA');
assert.equal(auditoria[3].situacao, 'SEM_DOCUMENTOS_DE_RECEITA');
console.log('auditoria-mensal-receita.test: confronto mensal informativo: OK');

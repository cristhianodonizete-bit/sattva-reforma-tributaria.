const assert = require('node:assert/strict');
const { filtrarLinhasDoEscopo } = require('../src/services/consolidacaoOficial');

const periodo = { competencia_inicio: '2026-01', competencia_fim: '2026-07' };
const linhas = [
  { sentido:'saida', tipo_movimento:'cliente', competencia:'2026-04', modelo_documento_fiscal:'nfse', origem_movimento:'xml', valor:100 },
  { sentido:'saida', tipo_movimento:'cliente', competencia:'2026-04', modelo_documento_fiscal:'nfe', origem_movimento:'xml', cfop:'5152', valor:200 },
  { sentido:'saida', tipo_movimento:'cliente', competencia:'2026-04', modelo_documento_fiscal:'nfe', origem_movimento:'xml', cfop:'5102', valor:300 },
  { sentido:'saida', tipo_movimento:'cliente', competencia:'2026-08', modelo_documento_fiscal:'nfse', origem_movimento:'xml', valor:400 },
  { sentido:'saida', tipo_movimento:'cliente', competencia:'2026-04', modelo_documento_fiscal:'nfse', origem_movimento:'teste', valor:900 },
  { sentido:'entrada', tipo_movimento:'fornecedor', competencia:'2026-04', modelo_documento_fiscal:'nfe', origem_movimento:'xml', valor:500 },
];

assert.deepEqual(filtrarLinhasDoEscopo(linhas, 'cliente', periodo).map((x) => x.valor), [100, 300]);
assert.deepEqual(filtrarLinhasDoEscopo(linhas, 'fornecedor', periodo).map((x) => x.valor), [500]);
console.log('cadeia-periodo-receita.test: período e operação de receita respeitados: OK');

const assert = require('assert');
const {
  chaveIdentidade,
  compararCamadas,
  compararRegistros,
  totaisPorCompetencia,
} = require('../src/services/auditoriaFontesOperacionais');

const base = {
  id: 10, tipo: 'cliente', chave: '351234', item_numero: 1,
  competencia: '2026-01', data_emissao: '2026-01-15', documento: '100',
  inscr_federal: '12345678000190', descricao: 'Servico', valor: 100,
  situacao_documento: 'AUTORIZADO', cst: '000', cclasstrib: '000001',
  origem: 'XML',
};

assert.strictEqual(chaveIdentidade(base), 'FISCAL|cliente|351234|1');

const comparacao = compararCamadas(
  [base, { ...base, id: 20, chave: '351235', documento: '101' }, { ...base, id: 30, chave: '351236', documento: '102' }],
  [{ ...base, id: 10 }, { ...base, id: 40, chave: '351235', documento: '101', valor: 99 }, { ...base, id: 50, chave: '351237', documento: '103' }],
  [{ movimento_id: 50, execucao_id: 9, preco_atual: 100 }],
);

assert.strictEqual(comparacao.find((x) => x.chave_identidade.includes('351234')).status, 'CONFERE');
assert.strictEqual(comparacao.find((x) => x.chave_identidade.includes('351235')).status, 'DIVERGENCIA_DE_CONTEUDO');
assert.strictEqual(comparacao.find((x) => x.chave_identidade.includes('351236')).status, 'SO_NA_FONTE_CANONICA');
assert.ok(comparacao.some((x) => x.chave_identidade.includes('351237') && x.status === 'SO_NO_CACHE_LOCAL'));
assert.strictEqual(comparacao.find((x) => x.status === 'RESULTADO_DERIVADO_ORFAO').motor[0].movimento_id, 50);

const totais = totaisPorCompetencia([base], [{ ...base, id: 10 }], [{ movimento_id: 10, preco_atual: 100 }]);
assert.deepStrictEqual(totais, [{
  competencia: '2026-01',
  fonte_canonica: { documentos: 1, valor: 100, documentos_receita: 0, receita: 0, documentos_cancelados: 0, valor_cancelado: 0 },
  cache_local: { documentos: 1, valor: 100, documentos_receita: 0, receita: 0, documentos_cancelados: 0, valor_cancelado: 0 },
  motor: { documentos: 1, valor: 100, documentos_receita: 0, receita: 0, documentos_cancelados: 0, valor_cancelado: 0 },
}]);

const cancelada = { ...base, chave: '351299', cfop: '5102', situacao_documento: 'CANCELADO' };
const totalCancelado = totaisPorCompetencia([cancelada], [cancelada], []);
assert.strictEqual(totalCancelado[0].fonte_canonica.receita, 0);
assert.strictEqual(totalCancelado[0].fonte_canonica.documentos_cancelados, 1);

const fornecedores = compararRegistros('parceiros',
  [{ id: 1, empresa_id: 8, tipo: 'fornecedor', cnpj: '12.345.678/0001-90', descricao: 'Empresa A', regime: 'lucro_real' }],
  [{ id: 99, empresa_id: 8, tipo: 'fornecedor', cnpj: '12345678000190', descricao: 'Empresa A', regime: 'simples_nacional' }],
);
assert.strictEqual(fornecedores.resumo.DIVERGENCIA_DE_CONTEUDO, 1);

const perfis = compararRegistros('perfil_cbs_competencias',
  [{ id: 1, empresa_id: 8, competencia: '2026-01', cbs_debito: 100 }],
  [{ id: 2, empresa_id: 8, competencia: '2026-01', cbs_debito: 100 }],
);
assert.strictEqual(perfis.resumo.CONFERE, 1);

console.log('OK auditoria-fontes-operacionais');

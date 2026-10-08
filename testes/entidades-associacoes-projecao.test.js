const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-entidades-associacoes-'));
const { projetarItem } = require('../src/engine/motor');

const valor = 598.83;
const resultado = projetarItem({
  valor, valor_total: valor,
  descricao: 'Contribuição associativa mensal',
  entradaManual: { itemChave: '3_7_03_015_022_ENTIDADES_E_ASSOCIACOES', geraCredito: true },
}, {
  sentido: 'entrada', ano: 2027, empresa: { regime: 'lucro_real' }, regimeContraparte: 'simples_nacional',
});

assert.equal(resultado.precoAtual, valor, 'a despesa integral deve permanecer na análise financeira');
assert.equal(resultado.classificacao.cst, '');
assert.equal(resultado.classificacao.cclasstrib, '');
assert.equal(resultado.classificacao.status, 'CLASSIFICACAO_FISCAL_PENDENTE');
assert.equal(resultado.cbs, 0);
assert.equal(resultado.creditoCbs, 0);
assert.equal(resultado.creditoPisCofinsAdquirente.valor, 0);
assert.equal(resultado.creditoPisCofinsAdquirente.classificacao, 'CREDITO_HISTORICO_ZERO_CONTRIBUICAO_ASSOCIATIVA');
assert.equal(resultado.credito.status, 'PROJECAO_CONCLUIDA');
assert.equal(resultado.credito.motivo, 'Projeção concluída — contribuição associativa presumida; classificação fiscal pendente.');
assert.equal(resultado.projecaoContribuicaoAssociativa.impacto_diferenca_creditos, 0);

const comServicoIdentificado = projetarItem({
  valor, documento: 'NF-1', nbs: '115019900', descricao: 'Serviço específico',
  entradaManual: { itemChave: '3_7_03_015_022_ENTIDADES_E_ASSOCIACOES', geraCredito: true },
}, {
  sentido: 'entrada', ano: 2027, empresa: { regime: 'lucro_real' }, regimeContraparte: 'lucro_real',
});
assert.equal(comServicoIdentificado.projecaoContribuicaoAssociativa, null,
  'a premissa não pode substituir o tratamento de serviço identificado');

console.log('entidades-associacoes-projecao.test: contribuição associativa pendente e sem crédito: OK');

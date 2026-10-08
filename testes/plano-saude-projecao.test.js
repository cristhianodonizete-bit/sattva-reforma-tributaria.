const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-plano-saude-'));
const regras = require('../src/services/regras');
const { projetarItem } = require('../src/engine/motor');

const fatura = 3295.72;
const resultado = projetarItem({
  valor: fatura, valor_total: fatura, cfop: '1933', nbs: '1.0910.10.00',
  descricao: 'Plano privado de assistência à saúde empresarial',
}, {
  sentido: 'entrada', ano: 2027, empresa: { regime: 'lucro_real' }, regimeContraparte: 'lucro_real',
});

assert.equal(resultado.classificacao.cst, '011');
assert.equal(resultado.classificacao.cclasstrib, '011002');
assert.equal(resultado.projecaoPlanoSaude.base_financeira, fatura,
  'a fatura integral deve compor a projeção, sem reduzir para a base PIS/Cofins');
assert.equal(resultado.projecaoPlanoSaude.participacao_empresa, 1);
assert.equal(resultado.projecaoPlanoSaude.participacao_empregados, 0);
assert.equal(resultado.projecaoPlanoSaude.coparticipacao_empregados, 0);
assert.equal(resultado.creditoCbs, 0, 'estimativa de plano de saúde não pode entrar como crédito habilitado');
assert.ok(resultado.creditoCbsEstimado > 0, 'a simulação não pode bloquear por ausência do débito da operadora');
assert.equal(resultado.credito.status, 'PROJECAO_ESTIMADA');
assert.match(resultado.credito.motivo, /participação financeira integral da empresa/i);
assert.equal(resultado.creditoPisCofinsAdquirente.valor, 0);
assert.equal(resultado.creditoPisCofinsAdquirente.classificacao, 'CREDITO_HISTORICO_ZERO_PLANO_SAUDE');

const fator = regras.padrao('fator_cbs_estimado_planos_saude', 0.4);
assert.equal(resultado.projecaoPlanoSaude.aliquota_estimada, resultado.aliquotas.aliquotaReferencia.cbs * fator);
assert.equal(resultado.creditoCbsEstimado, Math.round(fatura * resultado.projecaoPlanoSaude.aliquota_estimada * 100) / 100,
  'a estimativa específica usa a alíquota parametrizada do regime, não a CBS geral sobre a base econômica');
assert.notEqual(resultado.creditoCbsEstimado, Math.round(resultado.baseEconomica * resultado.aliquotas.aliquotaReferencia.cbs * 100) / 100);

const comDebitoOperadora = projetarItem({
  valor: fatura, nbs: '109101000', descricao: 'Plano de saúde',
  planoSaude: { debito_cbs_operadora: 88.76, participacao_empresa: 1, elegibilidade_legal_confirmada: true },
}, { sentido: 'entrada', ano: 2027, empresa: { regime: 'lucro_real' }, regimeContraparte: 'lucro_real' });
assert.equal(comDebitoOperadora.projecaoPlanoSaude.debito_operadora_informado, true);
assert.equal(comDebitoOperadora.creditoCbsEstimado, 88.76);
assert.equal(comDebitoOperadora.creditoCbs, 0);
console.log('plano-saude-projecao.test: projeção específica separada da apropriação efetiva: OK');

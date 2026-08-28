const assert = require('assert');
const { ESTADOS, avaliar, consolidar } = require('../src/services/autonomiaTelemetry');

const base = (extra = {}) => ({
  sentido: 'entrada', ncm: '12345678', nbs: null, status_classificacao: 'CLASSIFICADO',
  status_credito_determinacao: 'DETERMINADO', natureza: 'SIMULADO', regra_version: 'R1',
  detalhe: { classificacao: { origem: 'CATALOGO', fundamentos: ['Regra única aplicável.'] }, reconstrucao: { status: 'reconstruida' } }, ...extra,
});

assert.equal(avaliar(base()).estado_autonomia, ESTADOS.AUTOMATICO, 'catálogo determinístico é resolução automática');
assert.equal(avaliar(base({ detalhe: { classificacao: { origem: 'DOCUMENTO', fundamentos: ['XML válido.'] }, reconstrucao: { status: 'reconstruida' } } })).estado_autonomia, ESTADOS.EVIDENCIA, 'evidência documental permanece distinguível da regra automática');
assert.equal(avaliar(base({ status_credito_determinacao: 'DETERMINADO_POR_PREMISSA' })).estado_autonomia, ESTADOS.PREMISSA, 'premissa explícita não vira evidência');
assert.equal(avaliar(base({ status_credito_determinacao: 'INDETERMINADO' })).estado_autonomia, ESTADOS.INDETERMINADO, 'indeterminado decidido é autônomo');
const humana = avaliar(base({ ncm: null, nbs: null, status_classificacao: 'REQUER_VALIDACAO', status_credito_determinacao: 'SUJEITO_VALIDACAO' }));
assert.equal(humana.estado_autonomia, ESTADOS.HUMANO, 'validação fiscal vira intervenção humana');
assert.equal(humana.codigo_causa, 'NCM_AUSENTE', 'ausência de chave recebe causa padronizada');
assert.equal(avaliar(base({ detalhe: { classificacao: { origem: 'CATALOGO' }, reconstrucao: { status: 'insuficiente' } } })).codigo_causa, 'EVIDENCIA_BASE_INSUFICIENTE', 'base insuficiente permanece explicitamente pendente');

const resumo = consolidar([base(), base({ status_credito_determinacao: 'DETERMINADO_POR_PREMISSA' }), base({ status_credito_determinacao: 'INDETERMINADO' }), base({ status_classificacao: 'REQUER_VALIDACAO', ncm: null, nbs: null })].map((x) => ({ ...x, ...avaliar(x) })));
assert.equal(resumo.operacoes_autonomas, 3, 'indeterminado automático conta na autonomia');
assert.equal(resumo.operacoes_intervencao, 1, 'somente ação humana entra na intervenção');
assert.equal(resumo.taxa_autonomia, .75, 'taxa é calculada sobre todas as operações');

console.log('autonomia-telemetry.test: taxonomia, causa e métricas aprovadas');

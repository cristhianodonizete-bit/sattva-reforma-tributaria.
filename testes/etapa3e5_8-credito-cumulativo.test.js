const assert = require('assert');
const { resolverCreditoPisCofinsAdquirente } = require('../src/engine/calculadora');

const cumulativa = resolverCreditoPisCofinsAdquirente({ regimeAdquirente: 'lucro_presumido' });
assert.equal(cumulativa.valor, 0);
assert.equal(cumulativa.status, 'DETERMINADO');
assert.equal(cumulativa.classificacao, 'CREDITO_NAO_ELEGIVEL_POR_REGIME');
assert.equal(cumulativa.origem, 'REGRA_REGIME_ADQUIRENTE');
assert.ok(cumulativa.hash_lineage);

const superior = resolverCreditoPisCofinsAdquirente({
  regimeAdquirente: 'lucro_presumido',
  regraEspecificaCredito: { elegibilidade: 'ELEGIVEL', motivo: 'Hipótese específica versionada.' },
});
assert.equal(superior.classificacao, 'CREDITO_ELEGIVEL_POR_REGRA_ESPECIFICA');
assert.equal(superior.origem, 'REGRA_ESPECIFICA');

const naoCumulativa = resolverCreditoPisCofinsAdquirente({ regimeAdquirente: 'lucro_real' });
assert.equal(naoCumulativa.classificacao, 'CREDITO_INDETERMINADO');
assert.equal(naoCumulativa.valor, null);

const condicional = resolverCreditoPisCofinsAdquirente({
  regimeAdquirente: 'lucro_presumido',
  referenciaFiscal: { elegibilidade: 'DEPENDE_CONDICAO', motivo: 'Condição não comprovada.' },
});
assert.equal(condicional.classificacao, 'CREDITO_DEPENDE_CONDICAO_ESPECIFICA');
assert.equal(condicional.valor, null);

console.log('Etapa 3E.5.8: crédito PIS/Cofins cumulativo aprovado.');

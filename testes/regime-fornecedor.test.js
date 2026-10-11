'use strict';
const assert = require('node:assert/strict');
const regimeFornecedor = require('../src/services/regimeFornecedor');
assert.equal(regimeFornecedor.ehSociedadeAnonima('ALGAR MULTIMIDIA S/A'), true);
assert.equal(regimeFornecedor.ehSociedadeAnonima('EMPRESA TESTE LTDA'), false);
assert.equal(regimeFornecedor.resolver('simples_nacional', 'ALGAR MULTIMIDIA S/A'), 'regime_regular');
assert.equal(regimeFornecedor.resolver('lucro_real', 'COMPANHIA S/A'), 'lucro_real');
assert.equal(regimeFornecedor.resolver('simples_nacional', 'EMPRESA LTDA'), 'simples_nacional');
console.log('OK - sociedade anonima nunca e classificada como Simples ou MEI');

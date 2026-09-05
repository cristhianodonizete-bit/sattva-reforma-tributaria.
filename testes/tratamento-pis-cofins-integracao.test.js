const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-tratamento-pis-'));
const { catalogoResolvido, especificacao } = require('../src/services/tratamentoPisCofins');
const { reconstruir } = require('../src/engine/reconstrucao');

const zero = especificacao('ALIQUOTA_ZERO_PIS_COFINS');
assert.deepEqual([zero.cst_pis, zero.cst_cofins, zero.pis_percentual, zero.cofins_percentual], ['06', '06', 0, 0]);
const rZero = reconstruir({ valor: 10000, regime: 'lucro_real', regra_geral_regime_confirmada: true,
  catalogo_fiscal: catalogoResolvido('ALIQUOTA_ZERO_PIS_COFINS', 'R-ZERO') });
assert.equal(rZero.memoriaPisCofins.carga_atual_pis_cofins_valor, 0);
assert.equal(rZero.memoriaTributos.pis.aliquota, 0);

const cumulativo = especificacao('CUMULATIVO_OBRIGATORIO');
assert.deepEqual([cumulativo.cst_pis, cumulativo.cst_cofins, cumulativo.pis_percentual, cumulativo.cofins_percentual], ['01', '01', 0.65, 3]);
const rCumulativo = reconstruir({ valor: 10000, regime: 'lucro_real', regra_geral_regime_confirmada: true,
  catalogo_fiscal: catalogoResolvido('CUMULATIVO_OBRIGATORIO', 'R-CUM') });
assert.equal(rCumulativo.memoriaPisCofins.carga_atual_pis_cofins_percentual, 3.65);
assert.equal(rCumulativo.memoriaPisCofins.carga_atual_pis_cofins_valor, 365);
assert.equal(rCumulativo.memoriaTributos.pis.valor, 65);
assert.equal(rCumulativo.memoriaTributos.cofins.valor, 300);

console.log('tratamento-pis-cofins-integracao: zero e cumulatividade obrigatória aplicam CST, percentual e valor certificados');
require('../src/db').close(); fs.rmSync(process.env.SATTVA_DADOS, { recursive: true, force: true });

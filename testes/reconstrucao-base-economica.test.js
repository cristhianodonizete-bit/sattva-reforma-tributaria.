const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-reconstrucao-'));

const db = require('../src/db');
const regras = require('../src/services/regras');
const { reconstruir } = require('../src/engine/reconstrucao');
const { projetarItem } = require('../src/engine/motor');

// Lucro Presumido padrão: regra central, não número hardcoded no catálogo.
let r = reconstruir({ valor: 100, tipo: 'servico', regime: 'lucro_presumido' });
assert.equal(r.tributosAtuais.pis, 0.65);
assert.equal(r.tributosAtuais.cofins, 3);
assert.equal(r.memoriaTributos.pis.origem, 'REGRA_REGIME');
assert.equal(r.memoriaTributos.pis.natureza, 'CALCULADO');

// Catálogo condicional sem impedimento material deve continuar a precedência.
r = reconstruir({ valor: 100, tipo: 'servico', regime: 'lucro_presumido', catalogo_fiscal: {
  cumulatividade_obrigatoria: 'SIM', grau_determinacao: 'CONDICIONADO', condicao_cumulatividade: 'depende de validação operacional',
} });
assert.equal(r.tributosAtuais.pis, 0.65);
assert.equal(r.tributosAtuais.cofins, 3);
assert.equal(r.memoriaPisCofins.base_reconstrucao_metodo, 'REGRA_GERAL_REGIME');

// Regra específica conclusiva prevalece sobre o fallback de 3,65%.
r = reconstruir({ valor: 100, tipo: 'servico', regime: 'lucro_presumido', catalogo_fiscal: { tratamento_pis_cofins: 'ALÍQUOTA ZERO' } });
assert.equal(r.tributosAtuais.pis + r.tributosAtuais.cofins, 0);
assert.equal(r.memoriaPisCofins.base_reconstrucao_metodo, 'ALIQUOTA_ZERO');

// Condição explicitamente material não se torna zero: a base fica parcial.
r = reconstruir({ valor: 100, tipo: 'servico', regime: 'lucro_presumido', catalogo_fiscal: {
  cumulatividade_obrigatoria: 'SIM', grau_determinacao: 'CONDICIONADO', condicao_cumulatividade: 'BLOQUEIA_FALLBACK: papel na cadeia ausente',
} });
assert.equal(r.tributosAtuais.pis + r.tributosAtuais.cofins, 0);
assert.equal(r.status, 'parcialmente_determinada');
assert.equal(r.memoriaTributos.pis.status, 'INDETERMINADO');

// Serviço sem ISS documental não recebe 2% por default silencioso.
r = reconstruir({ valor: 100, tipo: 'servico', regime: 'lucro_presumido' });
assert.equal(r.tributosAtuais.iss, 0);
assert.equal(r.memoriaTributos.iss.status, 'INDETERMINADO');

// ISS documentado continua real e rastreável.
r = reconstruir({ valor: 100, tipo: 'servico', regime: 'lucro_presumido', iss: 2 });
assert.equal(r.tributosAtuais.iss, 2);
assert.equal(r.memoriaTributos.iss.origem, 'DOCUMENTO');
assert.equal(r.memoriaTributos.iss.natureza, 'REAL');

// IBS desabilitado precisa resultar zero no cálculo, não apenas sumir da tela.
db.prepare('UPDATE param_aliquotas SET calcular_ibs = 0, ibs = 0.177, cbs = 0.0921 WHERE ano = 2027').run();
regras.invalidar();
const p = projetarItem({ valor: 100, cfop: '5102', descricao: 'serviço', iss: 2 }, {
  sentido: 'saida', ano: 2027, empresa: { regime: 'lucro_presumido' }, regimeContraparte: 'lucro_real',
});
assert.equal(p.ibs, 0);
assert.equal(p.precoProjetado, Math.round((p.baseEconomica + p.cbs) * 100) / 100);

console.log('reconstrucao-base-economica.test: precedência, ISS rastreável e IBS desabilitado validados');

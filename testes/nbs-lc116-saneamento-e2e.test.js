const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-nbs-e2e-'));
const motor = require('../src/services/motorCondicionalPisCofins');
const saneamento = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'outputs', 'nbs_lc116_saneamento_120_rascunhos.json'), 'utf8'));
const reclassificadas = saneamento.filter((item) => item.decisao === 'RASCUNHO_VALIDO_APENAS_COM_CONDICAO');
const obsoletas = saneamento.filter((item) => item.decisao === 'RASCUNHO_OBSOLETO');

assert.equal(reclassificadas.length, 114);
assert.equal(obsoletas.length, 6);
for (const item of reclassificadas) {
  const fato = item.fatos[0];
  const regra = {
    regra_id: item.id_regra,
    familia_regra: item.familia_juridica,
    prioridade: 100,
    vigencia_inicio: '2004-01-01',
    vigencia_fim: '2099-12-31',
    regime_pis_cofins: 'CUMULATIVO',
    condicoes: [{ fato, operador: 'VERDADEIRO' }],
    resultado: { tratamento: 'CUMULATIVO_OBRIGATORIO', cst_pis: item.cst_pis, cst_cofins: item.cst_cofins }
  };
  const base = { data_operacao: '2026-09-05', regime_pis_cofins: 'CUMULATIVO' };
  assert.equal(motor.selecionar([regra], { ...base, fatos_documento: { [fato]: true } }).status, 'APLICAVEL', item.id_regra);
  assert.equal(motor.selecionar([regra], { ...base, fatos_documento: { [fato]: false } }).status, 'NAO_APLICAVEL', item.id_regra);
  assert.equal(motor.selecionar([regra], base).status, 'INDETERMINADA', item.id_regra);
  assert.equal(motor.selecionar([regra], { ...base, data_operacao: '2100-01-01', fatos_documento: { [fato]: true } }).status, 'NAO_APLICAVEL', item.id_regra);
  assert.equal(motor.selecionar([regra], { ...base, regime_pis_cofins: 'NAO_CUMULATIVO', fatos_documento: { [fato]: true } }).status, 'NAO_APLICAVEL', item.id_regra);
}
for (const item of obsoletas) {
  assert.equal(item.status_final, 'OBSOLETO_INATIVO_NAO_PUBLICAVEL');
  assert.equal(item.classificacao_canonica_final, 'REGRA_GERAL_RESIDUAL');
}
console.log(`nbs-lc116-saneamento-e2e: ${reclassificadas.length * 5 + obsoletas.length * 2} verificações aprovadas`);
require('../src/db').close();
fs.rmSync(process.env.SATTVA_DADOS, { recursive: true, force: true });

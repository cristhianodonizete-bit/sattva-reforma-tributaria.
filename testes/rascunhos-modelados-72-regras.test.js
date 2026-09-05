const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { executar } = require('../scripts/gerar_rascunhos_modelados_72_regras');
const raiz = path.resolve(__dirname, '..'); const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-rascunhos-'));
const resultado = executar(path.join(raiz, 'outputs/mapeamento_legal_76_diretas.json'), destino);
assert.equal(resultado.resumo.registros_modelados, 72);
assert.equal(resultado.resumo.zero_mantido_modelados, 51);
assert.equal(resultado.resumo.lc224_modelados, 21);
assert.equal(resultado.resumo.regras_modeladas, 114);
assert.equal(resultado.resumo.regras_historicas_ate_20260331, 21);
assert.equal(resultado.resumo.regras_desde_20260401, 42);
assert.equal(resultado.resumo.condicionais_indevidamente_incluidos.length, 0);
assert.equal(resultado.resumo.revisao_juridica_indevidamente_incluida.length, 0);
assert.equal(resultado.resumo.vigencias_sobrepostas.length, 0);
assert.equal(resultado.resumo.percentuais_fora_do_contrato.length, 0);
const lc = resultado.rascunhos.find((r) => r.regime === 'REGIME_CUMULATIVO' && r.vigencia_inicio === '2026-04-01');
assert(lc && lc.cst_pis === '06' && lc.pis_percentual === 0.065 && lc.cofins_percentual === 0.30);
// Seleção somente em memória, equivalente ao contrato de vigência do resolvedor.
const selecionar = (ncm, data, regime) => resultado.rascunhos.find((r) => r.ncm === ncm && r.regime === regime
  && (!r.vigencia_inicio || r.vigencia_inicio <= data) && (!r.vigencia_fim || r.vigencia_fim >= data));
const zeroMantido = resultado.rascunhos.find((r) => r.tratamento_resultante === 'ALIQUOTA_ZERO_PIS_COFINS' && !r.vigencia_fim);
assert(zeroMantido); // A: zero mantido.
const ncmLc224 = lc.ncm;
const cumulativoDepois = selecionar(ncmLc224, '2026-04-01', 'REGIME_CUMULATIVO');
const naoCumulativoDepois = selecionar(ncmLc224, '2026-04-01', 'REGIME_NAO_CUMULATIVO');
const historicaAntes = selecionar(ncmLc224, '2026-03-31', 'TODOS');
assert.deepStrictEqual([cumulativoDepois.pis_percentual, cumulativoDepois.cofins_percentual], [0.065, 0.30]); // B e E
assert.deepStrictEqual([naoCumulativoDepois.pis_percentual, naoCumulativoDepois.cofins_percentual], [0.165, 0.76]); // C
assert.deepStrictEqual([historicaAntes.pis_percentual, historicaAntes.cofins_percentual], [0, 0]); // D
console.log('Rascunhos das 72 regras: filtros, vigências, CST 06 e percentuais aprovados');

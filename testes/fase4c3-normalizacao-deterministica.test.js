const assert = require('assert');
const fs = require('fs');
const path = require('path');
const apuracoes = require('../src/services/apuracoesPisCofinsIa');

const campos = apuracoes.normalizarTextoDeterministico(`Competência: 07/2026
Regime PIS/Cofins: CUMULATIVO
Receita Base: R$ 1.000,00
PIS Débito: R$ 6,50
COFINS Débito: R$ 30,00`, {
  localizacoes: [{ texto: 'PIS Débito: R$ 6,50', pagina: 2, confianca: 0.91 }],
  metodo: 'NORMALIZACAO_DETERMINISTICA_AZURE',
});
assert.strictEqual(campos.competencia.valor_extraido, '2026-07');
assert.strictEqual(campos.receita_base.valor_extraido, 1000);
assert.strictEqual(campos.pis_debito.valor_extraido, 6.5);
assert.strictEqual(campos.cofins_debito.valor_extraido, 30);
assert.strictEqual(campos.pis_debito.pagina_ou_localizacao, 'p. 2');
assert.strictEqual(campos.pis_debito.status_validacao, 'REQUER_VALIDACAO');
assert.strictEqual(campos.cofins_credito.valor_extraido, null);
assert.strictEqual(campos.cofins_credito.status_validacao, 'INDETERMINADO');

const rota = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api.js'), 'utf8');
const inicio = rota.indexOf("router.post('/empresas/:id/apuracoes-pis-cofins/ingestao'");
const fim = rota.indexOf("router.get('/empresas/:id/apuracoes-pis-cofins'", inicio);
const ingestao = rota.slice(inicio, fim);
assert.match(ingestao, /normalizarTextoDeterministico/);
assert.doesNotMatch(ingestao, /ia\.config|ia\.chamar|normalizacaoApuracoesLlm/);

console.log('Normalização determinística Azure: rótulos literais, NULL e independência de LLM verificados.');

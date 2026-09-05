const assert = require('assert');
const { numero, candidatoBase, percentualSuspeito } = require('../scripts/gerar_previa_rascunhos_pis_cofins');
for (const [entrada, esperado] of [['0,65', 0.65], ['0.65', 0.65], ['3,00', 3], ['3.00', 3], ['1,65%', 1.65], ['7.60%', 7.6], ['9,25', 9.25]]) assert.strictEqual(numero(entrada), esperado, entrada);
assert.strictEqual(percentualSuspeito(0.65), false); assert.strictEqual(percentualSuspeito(300), true);
const item = candidatoBase({ tipo: 'NCM', linhaPlanilha: 2, linha: { NCM: '12345678', 'Tratamento específico PIS/COFINS vigente': 'ALÍQUOTA ZERO', 'Operação atual PIS/COFINS': 'Possível alíquota zero - hipótese legal específica', 'CST PIS atual': '06 se requisitos atendidos', 'CST COFINS atual': '06 se requisitos atendidos', 'Status da regra atual': 'VALIDAÇÃO NECESSÁRIA — regra atual condicionada', 'Papel na cadeia necessário': 'NÃO' } });
assert.strictEqual(item.elegivel_para_revisao, true); assert.strictEqual(item.elegivel_para_rascunho_operacional, false); assert.ok(item.bloqueios_para_ativacao.includes('REGRA_CONDICIONAL_NAO_ESTRUTURADA'));
console.log('gerar_previa_rascunhos_pis_cofins.test.js: PASSOU');

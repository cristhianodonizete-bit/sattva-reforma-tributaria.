const assert = require('node:assert/strict');
const { normalizarTextoDeterministico } = require('../src/services/apuracoesPisCofinsIa');

const relatorio = `Período: 01/06/2026 a 30/06/2026
- Entradas
Código da Situação Tributária PIS R$ Valor Receita R$ Base Cálculo R$ PIS
50 - Crédito 10.598,52 10.598,52 0,00
Código da Situação Tributária COFINS R$ Valor Receita R$ Base Cálculo R$ COFINS
50 - Crédito 10.598,52 10.598,52 0,00
Totalização por tipo
- Saídas
Código da Situação Tributária PIS R$ Valor Receita R$ Base Cálculo R$ PIS
01 - Tributável 254.124,34 254.124,34 1.651,82
Código da Situação Tributária COFINS R$ Valor Receita R$ Base Cálculo R$ COFINS
01 - Tributável 254.124,34 254.124,34 7.623,77
Totalização por tipo`;

const campos = normalizarTextoDeterministico(relatorio);
assert.equal(campos.competencia.valor_extraido, '2026-06');
const camposEmEnvelopeQuestor = normalizarTextoDeterministico(JSON.stringify({ PageCount:1, Data:relatorio }));
assert.equal(camposEmEnvelopeQuestor.receita_base.valor_extraido, 254124.34);
assert.equal(camposEmEnvelopeQuestor.pis_debito.valor_extraido, 1651.82);
assert.equal(campos.receita_base.valor_extraido, 254124.34);
assert.equal(campos.pis_debito.valor_extraido, 1651.82);
assert.equal(campos.cofins_debito.valor_extraido, 7623.77);
assert.equal(campos.competencia.valor_extraido, '2026-06');
// Retornos nWeb também podem vir em envelope aninhado, com HTML e quebras
// literais. A mesma totalização precisa continuar encontrável sem download.
const htmlQuestor = JSON.stringify({ resultado: { Data: `<table><tr><td>- Saídas</td></tr><tr><td>Código da Situação Tributária PIS R$ Valor Receita R$ Base Cálculo R$ PIS</td></tr><tr><td>01 - Tributável 254124.34 254124.34 1651.82</td></tr><tr><td>Código da Situação Tributária COFINS R$ Valor Receita R$ Base Cálculo R$ COFINS</td></tr><tr><td>01 - Tributável 254124.34 254124.34 7623.77</td></tr><tr><td>Totalização por tipo</td></tr></table>` } });
const camposHtml = normalizarTextoDeterministico(htmlQuestor);
assert.equal(camposHtml.receita_base.valor_extraido, 254124.34);
assert.equal(camposHtml.pis_debito.valor_extraido, 1651.82);
assert.equal(camposHtml.cofins_debito.valor_extraido, 7623.77);
console.log('apuracao-pis-cofins-saidas.test: totalização de saídas prevalece sobre entradas: OK');

#!/usr/bin/env node
/**
 * Regressão da leitura de vendas CBS.
 *
 * Protege a cadeia comercial definida para 2027:
 * venda atual - PIS/COFINS atual = base econômica; base × CBS = CBS da venda;
 * base + CBS = venda projetada; venda projetada - venda atual = impacto.
 */
const assert = require('node:assert/strict');
const { analisarCadeia } = require('../src/engine/cadeia');
const { calcularOperacao } = require('../src/engine/calculadora');

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const cfg = { lado: 'cliente', regimeEmpresa: 'lucro_real', anos: [2033], parametrosIVA: {
  2033: { cbs: 0.0925, ibs: 0.5, calcular_ibs: 0 },
} };

function cadeia(movimento) {
  return analisarCadeia([movimento], cfg);
}

function verificar(nome, encontrado, esperado) {
  assert.equal(encontrado, esperado, `${nome}: esperado ${esperado}, encontrado ${encontrado}`);
  console.log(`PASS  ${nome}: ${encontrado}`);
}

// Referência fiscal de serviço: 3,65% atual e CBS configurada em 9,25%.
{
  const r = cadeia({ valor: 1000, nome: 'Cliente PF', regime: 'pessoa_fisica', referenciaFiscal: { pis_cofins: 0.0365 } });
  const linha = r.regimes[0], detalhe = r.detalhes[0];
  verificar('base econômica pela referência', linha.baseEconomica, 963.5);
  verificar('PIS/COFINS atual', linha.pisCofinsAtual, 36.5);
  verificar('CBS da venda', linha.cbs, 89.12);
  verificar('IBS desabilitado', linha.ibs, 0);
  verificar('venda projetada', linha.precoProjetado, 1052.62);
  verificar('impacto em R$', linha.impactoOperacao, 52.62);
  verificar('impacto em %', detalhe.impactoOperacaoPerc, 0.0526);
  verificar('crédito potencial existe para PF', linha.creditoPotencial, 89.12);
  verificar('relevância para PF não altera o imposto', linha.relevanciaCreditoCliente, 'Não aplicável — consumidor final');
}

// Documento fiscal sempre prevalece à premissa cadastrada no serviço.
{
  const r = cadeia({ valor: 1000, nome: 'Cliente regular', regime: 'lucro_real', pis: 10, cofins: 20, referenciaFiscal: { pis_cofins: 0.0365 } });
  const linha = r.regimes[0], detalhe = r.detalhes[0];
  verificar('PIS/COFINS do documento prevalece', linha.pisCofinsAtual, 30);
  verificar('base econômica pelo documento', linha.baseEconomica, 970);
  verificar('CBS sobre a base econômica', linha.cbs, 89.73);
  verificar('origem documentada', detalhe.origemPisCofins, 'documento');
}

// Simples não apaga o imposto gerado na venda; altera só a relevância comercial.
{
  const r = cadeia({ valor: 500, nome: 'Cliente Simples', regime: 'simples_nacional', referenciaFiscal: { pis_cofins: 0.0365 } });
  const linha = r.regimes[0];
  verificar('CBS gerada na venda ao Simples', linha.cbs, r2(481.75 * 0.0925));
  verificar('crédito potencial da operação ao Simples', linha.creditoPotencial, r2(481.75 * 0.0925));
  verificar('relevância comercial do Simples', linha.relevanciaCreditoCliente, 'Sem apropriação no perfil informado');
}

// Entradas: fornecedor regular destaca CBS; a empresa adquirente regular toma
// o crédito correspondente. IBS permanece fora enquanto estiver desabilitado.
{
  const r = calcularOperacao({ valor: 1000, tipo: 'servico', regime: 'lucro_real', regimeAdquirente: 'lucro_real',
    pis: 0, cofins: 0, iss: 0, anos: [2033], parametrosIVA: { 2033: { cbs: 0.0925, ibs: 0.5, calcular_ibs: 0, fator_icms_iss: 0, fator_pis_cofins: 0, fator_ipi: 0 } } });
  const final = r.projecao[0];
  verificar('entrada regular — CBS destacada', final.cbs, 92.5);
  verificar('entrada regular — IBS desabilitado', final.ibs, 0);
  verificar('entrada regular — crédito CBS', final.credito.detalhe.cbs, 92.5);
  verificar('entrada regular — custo efetivo após crédito', final.custoEfetivo, 1000);
}

// Fornecedor do Simples não destaca CBS cheia; o crédito do adquirente é
// limitado à parcela embutida do DAS e nunca se confunde com CBS da operação.
{
  const r = calcularOperacao({ valor: 1000, tipo: 'servico', regime: 'simples_nacional', regimeAdquirente: 'lucro_real',
    aliqSimples: 0.06, anos: [2033], parametrosIVA: { 2033: { cbs: 0.0925, ibs: 0.5, calcular_ibs: 0, fator_icms_iss: 0, fator_pis_cofins: 0, fator_ipi: 0 } } });
  const final = r.projecao[0];
  verificar('entrada Simples — CBS cheia não destacada', final.cbs, 0);
  verificar('entrada Simples — crédito limitado é positivo', final.credito.total > 0, true);
  verificar('entrada Simples — crédito não excede tributos atuais', final.credito.total <= r.atual.totalTributos, true);
}

console.log('\nValidação CBS concluída com sucesso.');

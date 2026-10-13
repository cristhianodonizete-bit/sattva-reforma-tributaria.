#!/usr/bin/env node
/*
 * Regressão do relatório de entrega do Diagnóstico.
 * A leitura não pode disparar motor, carregar a carteira inteira para listar
 * benefícios, nem transformar PIS/Cofins ausente em zero.
 */
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const XLSX = require('xlsx');
const db = require('../src/db');
const saida = require('../src/services/saidaExecutiva');

const empresa = db.prepare('SELECT id FROM empresas ORDER BY id LIMIT 1').get();
if (!empresa) throw new Error('Fixture ausente: é necessária uma empresa para validar o relatório.');

const antes = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM motor_execucoes WHERE empresa_id=?').get(empresa.id).id;
const beneficios = saida.beneficiosNaFotografia(empresa.id);
const depois = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM motor_execucoes WHERE empresa_id=?').get(empresa.id).id;

assert.equal(depois, antes, 'relatório não pode executar o motor para listar benefícios');
assert.ok(Number.isFinite(beneficios.total), 'resumo de benefícios deve informar quantidade numérica');
assert.ok(Number.isFinite(beneficios.valor), 'resumo de benefícios deve informar valor numérico');
assert.ok(Array.isArray(beneficios.itens), 'benefícios deve retornar lista limitada de evidências');
assert.ok(beneficios.itens.length <= 12, 'relatório não pode materializar a carteira inteira na prévia');
assert.ok(['CALCULADO', 'INDETERMINADO'].includes(beneficios.natureza), 'natureza da evidência deve permanecer explícita');

const comparativoComDado = saida.comparativoPisCofins({ cbsLiquida: 150 }, { carga_pis_cofins_atual:{ valor:100, origem:'TESTE' } });
assert.equal(comparativoComDado.delta, 50, 'comparativo CBS x PIS/Cofins deve informar a variação quando existe carga histórica');
const comparativoSemDado = saida.comparativoPisCofins({ cbsLiquida: 150 }, { carga_pis_cofins_atual:{ valor:null } });
assert.equal(comparativoSemDado.pisCofins, null, 'PIS/Cofins ausente não pode virar zero');
assert.equal(comparativoSemDado.delta, null, 'sem PIS/Cofins não existe variação calculada');

(async () => {
  const relatorio = {
    geradoEm:new Date().toISOString(), statusEntrega:{ status:'PRELIMINAR', pronto:false }, empresa:{}, perfilAtual:{},
    conformidadeDocumental:{ resumo:{ total:0, valor:0 }, itens:[] }, planejamentoTributario:null,
    base:{ nome:'Fixture', ano:2027, receita:100, compras:80, baseEconomicaSaidas:90, baseEconomicaEntradas:70, cbsDebito:10, cbsCredito:8, cbsLiquida:2, creditoRecebido:8, creditoEntregue:5, custoEfetivo:72, operacoesCompras:1, operacoesVendas:1, natureza:'CALCULADO' },
    comparacao:[], secoes:{ compras:{ valor:80,baseEconomica:70,credito:8 }, vendas:{ valor:100,baseEconomica:90,cbs:10,precoProjetado:110 }, cbsXPisCofins:comparativoComDado, beneficios:{ ...beneficios, itens:beneficios.itens.slice(0,1) }, oportunidades:[], atencoes:[], limitacoes:[], premissas:[], metodologia:{ texto:'Fixture de validação.' } },
  };
  const stream = new PassThrough(); const partes=[]; stream.on('data',(x)=>partes.push(x));
  const terminou = new Promise((resolve,reject)=>{ stream.on('end',resolve); stream.on('error',reject); });
  saida.gerarPdf(relatorio, stream); await terminou;
  assert.equal(Buffer.concat(partes).toString('latin1',0,8), '%PDF-1.3', 'PDF do relatório deve ser válido');
  const xlsx=XLSX.read(saida.gerarXlsx(relatorio),{type:'buffer'});
  assert.ok(xlsx.SheetNames.includes('CBS x PIS Cofins') && xlsx.SheetNames.includes('Benefícios e tratamentos'), 'Excel deve conter as novas evidências');
  console.log(`saida-executiva.test: leitura, PDF e Excel aprovados sem nova execução do motor; ${beneficios.itens.length} evidência(s) na amostra.`);
})().catch((e)=>{ console.error(e); process.exitCode=1; });

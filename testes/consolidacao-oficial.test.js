#!/usr/bin/env node
/*
 * Regressão da Fase 1: uma única execução materializada deve alimentar as
 * duas cadeias, o Perfil CBS e o Impacto Final. Não usa a cadeia legada.
 */
const assert = require('node:assert/strict');
const db = require('../src/db');
const motorExec = require('../src/services/motorExec');
const oficial = require('../src/services/consolidacaoOficial');

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const empresa = db.prepare('SELECT id FROM empresas ORDER BY id LIMIT 1').get();
if (!empresa) throw new Error('Fixture ausente: é necessária uma empresa para a reconciliação oficial.');

motorExec.executar(empresa.id, { ano: 2027 });
const clientes = oficial.cadeia(empresa.id, 'cliente', { executarSeAusente: false });
const fornecedores = oficial.cadeia(empresa.id, 'fornecedor', { executarSeAusente: false });
const impacto = oficial.impactoFinal(empresa.id, { executarSeAusente: false });
const linhas = oficial.linhas(empresa.id, { executarSeAusente: false }).linhas;
const soma = (xs, campo) => r2(xs.reduce((s, x) => s + (Number(x[campo]) || 0), 0));
const debito = soma(linhas.filter((x) => x.sentido === 'saida'), 'cbs');
const credito = soma(linhas.filter((x) => x.sentido === 'entrada'), 'credito_cbs');

assert.equal(r2(clientes.totais.cbs), debito, 'Cadeia de Clientes deve ler a CBS de motor_resultados');
assert.equal(r2(fornecedores.totais.creditoFinal), credito, 'Cadeia de Fornecedores deve ler o crédito de motor_resultados');
assert.equal(impacto.cbs_debito_vendas, debito, 'Impacto Final deve ler o débito materializado');
assert.equal(impacto.cbs_credito_compras, credito, 'Impacto Final deve ler o crédito materializado');
assert.equal(impacto.cbs_liquida, r2(debito - credito), 'CBS líquida deve reconciliar');
assert.equal(impacto.reconciliacao.status, 'RECONCILIADO', 'Perfil CBS e motor_resultados devem reconciliar');
const rastreabilidade = clientes.detalhes[0];
assert.ok(rastreabilidade?.tributosRetirados, 'detalhe deve expor os tributos retirados da base');
assert.equal(typeof rastreabilidade.tributosRetirados.total, 'number');
assert.ok(rastreabilidade.formulaBaseEconomica, 'detalhe deve expor a fórmula da base econômica');
assert.ok(rastreabilidade.motivoBaseEconomica, 'detalhe deve expor o motivo da base econômica');
console.log(`consolidacao-oficial.test: ${linhas.length} operações reconciliadas em motor_resultados.`);

#!/usr/bin/env node
const assert = require('node:assert/strict');
const { analisarCadeia } = require('../src/engine/cadeia');

const cfg = { anos: [2027], parametrosIVA: {
  2027: { cbs: 0.0925, ibs: 0, calcular_ibs: 0, fator_icms_iss: 0, fator_pis_cofins: 0, fator_ipi: 0 },
} };
const r2 = (n) => Math.round(n * 100) / 100;

const vendas = analisarCadeia([
  { valor: 1000, nome: 'Cliente regular', regime: 'lucro_real', referenciaFiscal: { pis_cofins: 0.0365 } },
], { ...cfg, lado: 'cliente', regimeEmpresa: 'lucro_real' });
const compras = analisarCadeia([
  { valor: 500, nome: 'Fornecedor regular', regime: 'lucro_real', pis: 0, cofins: 0, iss: 0 },
], { ...cfg, lado: 'fornecedor', regimeEmpresa: 'lucro_real' });

const saidas = vendas.cenarios[0];
const creditoCbs = compras.detalhes.reduce((s, x) => s + x.creditoCbs, 0);
const pisDebito = vendas.detalhes.reduce((s, x) => s + x.pisCofinsAtual, 0);
const pisCredito = compras.detalhes.reduce((s, x) => s + x.creditoPisCofinsHoje, 0);

assert.equal(saidas.cbs, 89.12, 'CBS débito deve vir da Cadeia de Clientes');
assert.equal(r2(creditoCbs), 46.25, 'crédito CBS deve vir da Cadeia de Fornecedores');
assert.equal(r2(saidas.cbs - creditoCbs), 42.87, 'CBS líquida = débito − crédito');
assert.equal(r2(pisDebito - pisCredito), -9.75, 'PIS/COFINS líquido atual usa débitos − créditos');
console.log('PASS Impacto Final CBS: débitos, créditos e carga atual conciliados a partir das Cadeias.');

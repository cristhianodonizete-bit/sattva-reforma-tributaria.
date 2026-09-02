#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-faixas-'));
const { faixaTributacao } = require('../src/services/consolidacaoOficial');

const testar = (nome, linha, esperado) => {
  const resultado = faixaTributacao(linha);
  assert.deepEqual(resultado, esperado, nome);
  console.log(`PASS  ${nome}`);
};

testar('base integral', { detalhe: { classificacao: {} } }, { chave: 'INTEGRAL', label: 'Base integral' });
testar('redução de 40%', { detalhe: { classificacao: { reducaoCbs: 0.4 } } }, { chave: 'REDUCAO_40', label: 'Redução de 40%' });
testar('redução de 60%', { detalhe: { classificacao: { reducao_cbs: 0.6 } } }, { chave: 'REDUCAO_60', label: 'Redução de 60%' });
testar('alíquota zero', { detalhe: { classificacao: { reducao: 'zero' } } }, { chave: 'ALIQUOTA_ZERO', label: 'Alíquota zero' });
testar('CBS zero de MEI não equivale a alíquota zero', { tratamento: 'normal', cbs: 0, detalhe: { classificacao: {} } }, { chave: 'INTEGRAL', label: 'Base integral' });

console.log('Faixas de redução na cadeia validadas.');

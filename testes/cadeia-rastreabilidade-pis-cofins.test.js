#!/usr/bin/env node
/* Contrato da leitura limitada: não ocultar fornecedor, regime ou pendência. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const consolidacao = fs.readFileSync(path.join(raiz, 'src/services/consolidacaoOficial.js'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'public/js/telas.js'), 'utf8');
const limitada = consolidacao.slice(consolidacao.indexOf('function cadeiaLimitada('));

assert.match(consolidacao, /FORNECEDOR_EVIDENCIA_CNPJ/, 'a leitura deve reaproveitar o CNPJ já vinculado ao lançamento');
assert.match(consolidacao, /FORNECEDOR_EVIDENCIA_REGIME/, 'a leitura deve reaproveitar o regime já vinculado ao lançamento');
assert.match(consolidacao, /PIS_COFINS_ATUAL/, 'a pendência deve ser lida da fotografia persistida');
assert.match(limitada, /pendenciasPagina=pagina\.itens\.filter/, 'a página deve expor as suas pendências de PIS/Cofins');
assert.match(limitada, /resumoPendenciasPisCofins:\{registros:n\(pendenciasResumo\.registros\)/, 'o resumo deve contar a fotografia inteira no SQL');
assert.match(limitada, /paginacaoDetalhes:\{incluido/, 'a paginação numérica da rastreabilidade deve ser devolvida à tela');
assert.match(limitada, /pendenciasPisCofins:pendenciasPagina/,
  'a cadeia limitada ativa deve devolver as pendências da página, em vez de uma lista vazia artificial');
assert.match(tela, /resumoPendenciasPisCofins\.registros \?/, 'o aviso da tela deve obedecer ao total da fotografia, não só à página aberta');

console.log('cadeia-rastreabilidade-pis-cofins.test: fornecedor, regime, pendências e paginação preservados na leitura limitada.');

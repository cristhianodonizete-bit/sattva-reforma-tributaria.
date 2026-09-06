/* Bateria reproduzível: somente leitura sobre cópia local definida por SATTVA_DADOS. */
const oficial = require('../src/services/consolidacaoOficial');
const db = require('../src/db');
const empresa = db.prepare('SELECT id FROM empresas ORDER BY id LIMIT 1').get();
if (!empresa) throw new Error('Base sem empresa para teste de carga.');
const rodar = (nome, fn, n = 20) => {
  const tempos = [];
  for (let i = 0; i < n; i++) { const inicio = performance.now(); fn(); tempos.push(performance.now() - inicio); }
  tempos.sort((a, b) => a - b); const p = (q) => tempos[Math.ceil(tempos.length * q) - 1];
  const p95 = p(.95); const limites = { CARTEIRA: 20, CADEIA_CLIENTE_RESUMO: 50, IMPACTO_FINAL: 50 };
  console.log(`${nome}: p50=${p(.5).toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${p(1).toFixed(2)}ms limite=${limites[nome]}ms`);
  if (process.argv.includes('--assert') && p95 > limites[nome]) throw new Error(`${nome} excedeu p95 de ${limites[nome]}ms: ${p95.toFixed(2)}ms`);
};
rodar('CARTEIRA', () => db.prepare('SELECT id,razao_social,regime,uf FROM empresas ORDER BY razao_social').all());
rodar('CADEIA_CLIENTE_RESUMO', () => oficial.cadeia(empresa.id, 'cliente', { executarSeAusente: false, incluirDetalhes: false }));
rodar('IMPACTO_FINAL', () => oficial.impactoFinal(empresa.id, { executarSeAusente: false }));

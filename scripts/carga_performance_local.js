/* Bateria reproduzível: somente leitura sobre cópia local definida por SATTVA_DADOS. */
const oficial = require('../src/services/consolidacaoOficial');
const db = require('../src/db');
const empresa = db.prepare('SELECT id FROM empresas ORDER BY id LIMIT 1').get();
if (!empresa) throw new Error('Base sem empresa para teste de carga.');
const rodar = (nome, fn, n = 20) => {
  const tempos = [];
  for (let i = 0; i < n; i++) { const inicio = performance.now(); fn(); tempos.push(performance.now() - inicio); }
  tempos.sort((a, b) => a - b); const p = (q) => tempos[Math.ceil(tempos.length * q) - 1];
  console.log(`${nome}: p50=${p(.5).toFixed(2)}ms p95=${p(.95).toFixed(2)}ms max=${p(1).toFixed(2)}ms`);
};
rodar('CADEIA_CLIENTE_RESUMO', () => oficial.cadeia(empresa.id, 'cliente', { executarSeAusente: false, incluirDetalhes: false }));
rodar('IMPACTO_FINAL', () => oficial.impactoFinal(empresa.id, { executarSeAusente: false }));

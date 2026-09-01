const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const dir = path.join(os.tmpdir(), `sattva-cobertura-pendencias-${process.pid}-${Date.now()}`);
process.env.SATTVA_DADOS = dir;
const cobertura = require('../src/services/coberturaDiagnostico');

const base = {
  movimento_id: 10, valor: 1000, sentido: 'entrada',
  dimensoes: { classificacao: 'DETERMINADO', reconstrucao: 'INDETERMINADO', tratamento: 'DETERMINADO', credito: 'SUJEITO_VALIDACAO', resultado: 'INDETERMINADO' },
  linha: { documento: 'NF-10', cnpj: '12345678000199', competencia: '2026-01', parceiro: 'Fornecedor teste' },
};
const fila = cobertura.pendenciasOperacionais([base, { ...base, movimento_id: 11, valor: 800, dimensoes: { ...base.dimensoes, reconstrucao: 'DETERMINADO', classificacao: 'SUJEITO_VALIDACAO', resultado: 'SUJEITO_VALIDACAO' } }]);

assert.equal(fila.length, 2, 'cada operação pendente deve aparecer uma única vez');
assert.equal(fila[0].movimento_id, 10);
assert.equal(fila[0].dimensao, 'reconstrucao', 'reconstrução indeterminada é a causa principal quando impede o resultado');
assert.equal(fila[0].natureza, 'EVIDENCIA_EXTERNA');
assert.match(fila[0].fonte_minima, /XML, EFD-Contribuições, planilha\/ERP/);
assert.equal(fila[1].dimensao, 'classificacao');
assert.match(fila[1].acao, /classificação/i);
assert.equal(fila[0].valor + fila[1].valor, 1800, 'a fila não pode duplicar o valor por dimensão');
console.log('cobertura-pendencias-operacionais: fila exclusiva e acionável: OK');
try { require('../src/db').close?.(); } catch (_) { /* noop */ }
fs.rmSync(dir, { recursive: true, force: true });

/*
 * Auditoria isolada: usa o resolvedor produtivo em banco temporário.
 * Não abre nem altera o banco de trabalho.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-percentual-'));
const { resolver } = require('../src/services/catalogoFiscal');
const { numeroPontosPercentuais } = require('../src/services/percentual');

const base = 10000;
const casos = [
  ['0065', 0.065, 6.50], ['030', 0.30, 30], ['0165', 0.165, 16.50],
  ['076', 0.76, 76], ['065', 0.65, 65], ['165', 1.65, 165],
  ['300', 3, 300], ['760', 7.6, 760], ['925', 9.25, 925],
];
const resultado = {};
for (const [nome, percentual, esperado] of casos) {
  const real = resolver({ valor: base, catalogo_fiscal: { tratamento_pis_cofins: 'MONOFÁSICO', percentual_reconstrucao_sugerido: percentual } });
  const observado = Math.round(real.valor * 100) / 100;
  resultado[`TESTE_${nome}`] = { esperado, observado, status: observado === esperado ? 'PASSOU' : 'FALHOU' };
}
const parser = ['0,065','0.065','0,065%','0.065%','0,165','0.165','0,30','0.30','0,65','0.65','1,65','1.65','7,60','7.60']
  .map((entrada) => ({ entrada, resultado: numeroPontosPercentuais(entrada) }));
const esperadosParser = {
  '0,065':0.065,'0.065':0.065,'0,065%':0.065,'0.065%':0.065,'0,165':0.165,'0.165':0.165,
  '0,30':0.30,'0.30':0.30,'0,65':0.65,'0.65':0.65,'1,65':1.65,'1.65':1.65,'7,60':7.60,'7.60':7.60
};
const parserOk = parser.every(({ entrada, resultado: valor }) => esperadosParser[entrada] === valor);
const semHeuristica = numeroPontosPercentuais('0.0065') === 0.0065 && numeroPontosPercentuais('0.65') === 0.65;
const todosPassaram = Object.values(resultado).every((x) => x.status === 'PASSOU') && parserOk;
console.log(JSON.stringify({ resultado, parser, parser_ok: parserOk, sem_heuristica: semHeuristica, formula_produtiva: 'valor * (percentual / 100)' }, null, 2));
if (!todosPassaram || !semHeuristica) process.exitCode = 1;

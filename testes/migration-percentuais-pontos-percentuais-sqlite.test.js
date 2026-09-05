/*
 * Homologação isolada da semântica da migration V2. SQLite não executa
 * PL/pgSQL, então o teste reproduz as mesmas atualizações e o mesmo marcador
 * explícito de contrato, sem abrir o banco de trabalho.
 */
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const { aplicarPercentual } = require('../src/services/percentual');

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE parametros_operacionais (tabela TEXT, chave TEXT, dados TEXT, PRIMARY KEY(tabela,chave));
  CREATE TABLE param_regimes (pis_cofins REAL);
  CREATE TABLE base_ncm (pis_percentual REAL, cofins_percentual REAL, percentual_reconstrucao_sugerido REAL);
  CREATE TABLE base_servicos (pis_percentual REAL, cofins_percentual REAL, pis_cumulativo_percentual REAL, cofins_cumulativo_percentual REAL, total_cumulativo_percentual REAL, percentual_reconstrucao_sugerido REAL);
  CREATE TABLE empresa_servicos_fiscais (pis_cofins REAL);
  CREATE TABLE enriquecimento_pis_cofins_evidencias (aliquota_pis REAL, aliquota_cofins REAL);
`);

const pontos = [0, 0.065, 0.165, 0.30, 0.65, 0.76, 1.65, 3, 7.6, 9.25];
const legado = pontos.map((v) => v / 100);
for (const v of legado) {
  db.prepare('INSERT INTO param_regimes VALUES (?)').run(v);
  db.prepare('INSERT INTO base_ncm VALUES (?,?,?)').run(v, v, v);
  db.prepare('INSERT INTO base_servicos VALUES (?,?,?,?,?,?)').run(v, v, v, v, v, v);
  db.prepare('INSERT INTO empresa_servicos_fiscais VALUES (?)').run(v);
  db.prepare('INSERT INTO enriquecimento_pis_cofins_evidencias VALUES (?,?)').run(v, v);
}
db.prepare('INSERT INTO parametros_operacionais VALUES (?,?,?)').run('configuracao', 'param_regimes', JSON.stringify(legado.map((pis_cofins, i) => ({ chave: `r${i}`, pis_cofins }))));
const antes = db.prepare('SELECT pis_cofins FROM param_regimes').all().map((x) => x.pis_cofins);
const iguaisNaEscalaFiscal = (atuais, esperados) => {
  assert.strictEqual(atuais.length, esperados.length);
  atuais.forEach((valor, i) => assert.ok(Math.abs(valor - esperados[i]) < 1e-12, `posição ${i}: ${valor} != ${esperados[i]}`));
};

function migrar(confirmado) {
  const existente = db.prepare("SELECT dados FROM parametros_operacionais WHERE tabela='contrato_tecnico' AND chave='pis_cofins_percentual'").get();
  const versao = existente ? JSON.parse(existente.dados).versao : null;
  if (versao === '2') throw new Error('CONVERSAO_DUPLA_BLOQUEADA');
  if (versao !== null && versao !== '1') throw new Error('CONTRATO_DESCONHECIDO');
  if (confirmado !== 'FATOR_DECIMAL_V1') throw new Error('CONTRATO_LEGADO_NAO_CONFIRMADO');
  if (!existente) db.prepare('INSERT INTO parametros_operacionais VALUES (?,?,?)').run('contrato_tecnico', 'pis_cofins_percentual', JSON.stringify({ versao: '1', escala: 'FATOR_DECIMAL' }));
  const remoto = db.prepare("SELECT dados FROM parametros_operacionais WHERE tabela='configuracao' AND chave='param_regimes'").get();
  if (remoto) {
    const convertido = JSON.parse(remoto.dados).map((linha) => ({ ...linha,
      pis_cofins: typeof linha.pis_cofins === 'number' ? linha.pis_cofins * 100 : linha.pis_cofins }));
    db.prepare("UPDATE parametros_operacionais SET dados=? WHERE tabela='configuracao' AND chave='param_regimes'")
      .run(JSON.stringify(convertido));
  }
  db.exec(`
    UPDATE param_regimes SET pis_cofins=pis_cofins*100;
    UPDATE base_ncm SET pis_percentual=pis_percentual*100,cofins_percentual=cofins_percentual*100,percentual_reconstrucao_sugerido=percentual_reconstrucao_sugerido*100;
    UPDATE base_servicos SET pis_percentual=pis_percentual*100,cofins_percentual=cofins_percentual*100,pis_cumulativo_percentual=pis_cumulativo_percentual*100,cofins_cumulativo_percentual=cofins_cumulativo_percentual*100,total_cumulativo_percentual=total_cumulativo_percentual*100,percentual_reconstrucao_sugerido=percentual_reconstrucao_sugerido*100;
    UPDATE empresa_servicos_fiscais SET pis_cofins=pis_cofins*100;
    UPDATE enriquecimento_pis_cofins_evidencias SET aliquota_pis=aliquota_pis*100,aliquota_cofins=aliquota_cofins*100;
  `);
  db.prepare('UPDATE parametros_operacionais SET dados=? WHERE tabela=? AND chave=?').run(JSON.stringify({ versao: '2', escala: 'PONTOS_PERCENTUAIS' }), 'contrato_tecnico', 'pis_cofins_percentual');
}

assert.throws(() => migrar(null), /CONTRATO_LEGADO_NAO_CONFIRMADO/);
migrar('FATOR_DECIMAL_V1');
const depois = db.prepare('SELECT pis_cofins FROM param_regimes').all().map((x) => x.pis_cofins);
iguaisNaEscalaFiscal(antes, legado);
iguaisNaEscalaFiscal(depois, pontos);
iguaisNaEscalaFiscal(db.prepare('SELECT percentual_reconstrucao_sugerido valor FROM base_ncm').all().map((x) => x.valor), pontos);
iguaisNaEscalaFiscal(db.prepare('SELECT total_cumulativo_percentual valor FROM base_servicos').all().map((x) => x.valor), pontos);
iguaisNaEscalaFiscal(db.prepare('SELECT aliquota_pis valor FROM enriquecimento_pis_cofins_evidencias').all().map((x) => x.valor), pontos);
iguaisNaEscalaFiscal(JSON.parse(db.prepare("SELECT dados FROM parametros_operacionais WHERE tabela='configuracao' AND chave='param_regimes'").get().dados).map((x) => x.pis_cofins), pontos);
for (let i = 0; i < pontos.length; i++) {
  assert.ok(Math.abs((10000 * legado[i]) - aplicarPercentual(10000, pontos[i])) < 1e-9);
}
assert.throws(() => migrar('FATOR_DECIMAL_V1'), /CONVERSAO_DUPLA_BLOQUEADA/);
console.log('migration-percentuais-pontos-percentuais-sqlite.test: snapshot, preservação econômica e dupla execução bloqueada validados');

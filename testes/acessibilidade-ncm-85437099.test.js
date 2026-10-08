const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-acessibilidade-')); process.env.SATTVA_DADOS = dir;
const db = require('../src/db');
const { classificar } = require('../src/engine/classificador');

db.prepare(`INSERT INTO base_ncm (ncm, descricao, cclasstrib, classificacao, reducao)
  VALUES ('85437099', 'Outros aparelhos', '200031', 'Agenda eletrônica com teclado em braille', 'reduzida')`).run();

const facial = classificar({ ncm: '8543.70.99', descricao: 'CONTROLADOR FACE ACCESS SP X MIFARE' }, { sentido: 'entrada' });
assert.equal(facial.status, 'CLASSIFICADO');
assert.equal(facial.cclasstrib, '000001');
assert.match(facial.fundamentos.join(' '), /200031 eliminado/);

const braille = classificar({ ncm: '8543.70.99', descricao: 'Agenda eletrônica com teclado em braille, com sintetizador de voz' }, { sentido: 'entrada' });
assert.equal(braille.status, 'CLASSIFICADO');
assert.equal(braille.cclasstrib, '200031');

console.log('acessibilidade-ncm-85437099: benefício apenas com agenda em braille comprovada: OK');
try { db.close?.(); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true });

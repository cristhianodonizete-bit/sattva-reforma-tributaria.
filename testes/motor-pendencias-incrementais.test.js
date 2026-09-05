const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-motor-pendencias-'));
const db = require('../src/db');
const motorExec = require('../src/services/motorExec');

const empresaId = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('00000000000191','Empresa de teste','lucro_real')").run().lastInsertRowid);
const movimentoId = Number(db.prepare("INSERT INTO movimentos (empresa_id,tipo,nome,inscr_federal,descricao,ncm,valor,sentido) VALUES (?,?,?,?,?,?,?,?)")
  .run(empresaId, 'cliente', 'Cliente', '11111111000191', 'Item de teste', '01012100', 100, 'saida').lastInsertRowid);

const primeira = motorExec.pendentesIncrementais(empresaId);
assert.deepEqual(primeira, [movimentoId], 'a primeira versão deve enfileirar a fotografia existente uma única vez');
db.prepare('DELETE FROM motor_pendencias WHERE empresa_id=?').run(empresaId);
assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [], 'sem alteração não pode varrer nem reenfileirar a empresa');

db.prepare('UPDATE movimentos SET valor=? WHERE id=?').run(150, movimentoId);
assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [movimentoId], 'alteração do movimento deve marcar somente o item afetado');
db.prepare('DELETE FROM motor_pendencias WHERE empresa_id=?').run(empresaId);
db.prepare("INSERT INTO empresa_qsa (empresa_id,nome,brasileiro,percentual_participacao) VALUES (?,?,?,?)").run(empresaId, 'Sócio', 1, 100);
assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [movimentoId], 'alteração de QSA deve marcar as saídas da empresa');
db.prepare('DELETE FROM motor_pendencias WHERE empresa_id=?').run(empresaId);
db.prepare("INSERT INTO base_ncm (ncm,descricao) VALUES (?,?)").run('01012100', 'Catálogo de teste');
assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [movimentoId], 'alteração de catálogo deve marcar somente o NCM afetado');

console.log('motor-pendencias-incrementais: fila derivada, baseline e gatilhos de movimento/QSA: OK');

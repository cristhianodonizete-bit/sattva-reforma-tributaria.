const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-motor-telemetria-reuso-'));
process.env.SATTVA_DADOS = pasta;
const db = require('../src/db');
const motorExec = require('../src/services/motorExec');

const empresaId = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('00000000000192','Empresa de telemetria','lucro_real')").run().lastInsertRowid);
const inserir = db.prepare("INSERT INTO movimentos (empresa_id,tipo,nome,inscr_federal,descricao,ncm,cfop,valor,sentido) VALUES (?,?,?,?,?,?,?,?,?)");
inserir.run(empresaId, 'cliente', 'Consumidor', '', 'Produto repetido', '30049099', '5102', 100, 'saida');
inserir.run(empresaId, 'cliente', 'Consumidor', '', 'Produto repetido', '30049099', '5102', 250, 'saida');

const antes = db.prepare('SELECT COUNT(*) AS total FROM movimentos WHERE empresa_id=?').get(empresaId).total;
const resultado = motorExec.executar(empresaId, { gravar:false, telemetriaReuso:true });
const medicao = resultado.resumo.telemetria_reuso_classificacao;
assert.equal(medicao.executada, true);
assert.equal(medicao.itens_observados, 2);
assert.equal(medicao.contextos_distintos, 1);
assert.equal(medicao.classificacoes_potencialmente_reutilizaveis, 1);
assert.equal(medicao.alterou_resultado_oficial, false);
assert.equal(db.prepare('SELECT COUNT(*) AS total FROM movimentos WHERE empresa_id=?').get(empresaId).total, antes, 'telemetria não altera documentos');
assert.equal(db.prepare('SELECT COUNT(*) AS total FROM motor_resultados WHERE empresa_id=?').get(empresaId).total, 0, 'modo de teste não publicou fotografia');
console.log('motor-telemetria-reuso: mede repetição sem publicar nem alterar documentos: OK');
db.close();
fs.rmSync(pasta, { recursive:true, force:true });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-premissa-qsa-'));
const db = require('../src/db');
const motorExec = require('../src/services/motorExec');

const empresaId = Number(db.prepare(`INSERT INTO empresas (cnpj,razao_social,regime)
  VALUES ('17796012000177','Relotec','simples_nacional')`).run().lastInsertRowid);
db.prepare(`INSERT INTO base_ncm (ncm,cclasstrib,classificacao,reducao)
  VALUES ('84719014','200043','Hipótese para ente público','reducao_60'),
         ('84719014','200044','Hipótese com participação brasileira','reducao_60')`).run();
const inserirFornecedor = db.prepare(`INSERT INTO parceiros (empresa_id,tipo,cnpj,descricao,regime,multinacional)
  VALUES (?,?,?,?,?,?)`);
const inserirMovimento = db.prepare(`INSERT INTO movimentos (empresa_id,tipo,nome,inscr_federal,competencia,valor,ncm,cfop,cst,origem)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

inserirFornecedor.run(empresaId,'fornecedor','61099008000141','TAGUS-TEC','lucro_real',0);
inserirMovimento.run(empresaId,'fornecedor','TAGUS-TEC','61099008000141','2026-07',1000,'84719014','5102','00','xml');
let linha = motorExec.executar(empresaId,{ ano:2027 }).entradas[0];
assert.equal(linha.classificacao.status, 'CLASSIFICADO');
assert.equal(linha.classificacao.cclasstrib, '200044');
assert.equal(linha.credito.status, 'PROJETADO');
assert.ok(linha.creditoCbs > 0);
assert.equal(linha.classificacao.elegibilidadeAnexoXi.socio.percentual_participacao, 20);

inserirFornecedor.run(empresaId,'fornecedor','04215989000120','GOOGLE BRASIL','lucro_real',0);
inserirMovimento.run(empresaId,'fornecedor','GOOGLE BRASIL','04215989000120','2026-07',1000,'84719014','5102','00','xml');
const linhas = motorExec.executar(empresaId,{ ano:2027 }).entradas;
linha = linhas.find((x) => x.contraparte === 'GOOGLE BRASIL');
assert.equal(linha.classificacao.status, 'REQUER_VALIDACAO');
assert.equal(linha.credito.status, 'SUJEITO_VALIDACAO');

console.log('premissa-qsa-fornecedor: OK');
try { db.close?.(); } catch (_) {}
fs.rmSync(process.env.SATTVA_DADOS,{recursive:true,force:true});

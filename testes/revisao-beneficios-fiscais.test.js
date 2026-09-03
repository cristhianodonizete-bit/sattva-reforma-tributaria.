const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-revisao-beneficio-')); process.env.SATTVA_DADOS = dir;
const db = require('../src/db');
const revisoes = require('../src/services/revisaoBeneficiosFiscais');
const { classificar } = require('../src/engine/classificador');

const empresaId = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('12345678000199','Empresa teste','lucro_real')").run().lastInsertRowid);
db.prepare(`INSERT INTO base_servicos (lc116,nbs,descricao_item,cclasstrib,nome_cclasstrib,reducao) VALUES
 ('0106','115012000','Serviço teste','000001','Tributação integral','integral'),
 ('0106','115012000','Serviço teste','200044','Redução condicionada','reduzida')`).run();
const movimentoId = Number(db.prepare(`INSERT INTO movimentos (empresa_id,tipo,documento,lc116,nbs,valor,descricao)
 VALUES (?,?,?,?,?,?,?)`).run(empresaId,'cliente','NF-1','0106','115012000',1000,'Serviço teste').lastInsertRowid);
db.prepare(`INSERT INTO motor_execucoes (empresa_id,ano,resumo) VALUES (?,?,?)`).run(empresaId,2027,'{}');
db.prepare(`INSERT INTO motor_resultados (empresa_id,movimento_id,execucao_id,sentido,status_classificacao,preco_atual,cbs,cclasstrib,detalhe)
 VALUES (?,?,?,?,?,?,?,?,?)`).run(empresaId,movimentoId,1,'saida','CLASSIFICADO',1000,36.84,'200044',JSON.stringify({ classificacao:{ reducaoCbs:.6, reducao:'reduzida', cclasstrib:'200044', candidatos:[{ lc116:'0106',nbs:'115012000',cclasstrib:'200044' }] } }));

const criada = revisoes.criar(empresaId, { movimento_ids:[movimentoId], escopo:'ITENS_SELECIONADOS', nova_cclasstrib:'000001', motivo:'benefício não aplicável à empresa', justificativa:'Evidência contratual confirma que a condição específica não se aplica.' });
assert.equal(criada.movimento_ids.length, 1);
assert.equal(db.prepare('SELECT cclasstrib FROM movimentos WHERE id=?').get(movimentoId).cclasstrib, null, 'a revisão não pode alterar o XML/movimento');
const aplicada = revisoes.porMovimento(empresaId,[movimentoId]).get(movimentoId);
assert.equal(aplicada.candidato.cclasstrib,'000001');
const cls = classificar({ lc116:'0106',nbs:'115012000',revisaoBeneficio:aplicada },{ sentido:'saida' });
assert.equal(cls.cclasstrib,'000001'); assert.equal(cls.status,'CLASSIFICADO');
assert.throws(() => revisoes.criar(empresaId, { movimento_ids:[movimentoId], nova_cclasstrib:'999999', motivo:'outro', justificativa:'teste' }), /compatível/);
const revertida = revisoes.reverter(empresaId,criada.id,'Teste de reversão');
assert.deepEqual(revertida.movimento_ids,[movimentoId]);
assert.equal(revisoes.porMovimento(empresaId,[movimentoId]).size,0);
console.log('revisao-beneficios-fiscais: decisão auditável, escopo e reversão: OK');
try { db.close?.(); } catch (_) {} fs.rmSync(dir,{recursive:true,force:true});

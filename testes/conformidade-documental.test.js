const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-conformidade-documental-'));
const db = require('../src/db');
const conformidade = require('../src/services/conformidadeDocumental');

const empresa = db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('12345678000195','Empresa teste','lucro_presumido')").run();
const empresaId = Number(empresa.lastInsertRowid);
db.prepare(`INSERT INTO base_servicos (lc116,nbs,descricao_item,descricao_nbs,cclasstrib,nome_cclasstrib,reducao)
  VALUES ('0106','115012000','Serviços técnicos','Serviços técnicos especializados','000001','Tributação integral','integral'),
         ('0106','115013000','Serviços técnicos','Outra classificação técnica','200044','Redução 60%','reducao_60')`).run();
const inserir = db.prepare(`INSERT INTO movimentos (empresa_id,tipo,nome,descricao,valor,lc116,nbs,documento,origem)
  VALUES (?,?,?,?,?,?,?,?,?)`);
inserir.run(empresaId, 'cliente', 'Cliente A', 'Serviço técnico', 1000, '0106', '', 'NF-1', 'xml');
inserir.run(empresaId, 'cliente', 'Cliente B', 'Serviço técnico', 2000, '0106', '999999999', 'NF-2', 'xml');
inserir.run(empresaId, 'cliente', 'Cliente C', 'Serviço técnico', 3000, '0106', '115012000', 'NF-3', 'xml');

const resultado = conformidade.listar(empresaId);
assert.equal(resultado.resumo.total, 2, 'somente erros documentais devem aparecer');
const omissao = resultado.itens.find((x) => x.tipo === 'LC116_SEM_NBS');
assert.ok(omissao);
assert.equal(omissao.candidatos.length, 2);
assert.equal(omissao.candidatos[0].cst, null, 'CST ausente no catálogo não pode ser inventado');
const incompatibilidade = resultado.itens.find((x) => x.tipo === 'LC116_NBS_INCOMPATIVEIS');
assert.ok(incompatibilidade);
assert.match(incompatibilidade.evidencia, /não existe como chave composta/);
assert.equal(resultado.itens.some((x) => x.documento === 'NF-3'), false, 'chave composta exata não é erro documental');

// Mais de um cClassTrib para a mesma chave exige enquadramento no motor, mas
// não transforma LC116/NBS corretamente emitidos em erro documental.
db.prepare(`INSERT INTO base_servicos (lc116,nbs,descricao_item,descricao_nbs,cclasstrib,nome_cclasstrib,reducao)
  VALUES ('0106','115012000','Serviços técnicos','Serviços técnicos especializados','200044','Redução 60%','reducao_60')`).run();
inserir.run(empresaId, 'cliente', 'Cliente D', 'Serviço técnico', 4000, '0106', '115012000', 'NF-4', 'xml');
const comTratamentosAlternativos = conformidade.listar(empresaId);
assert.equal(comTratamentosAlternativos.itens.some((x) => x.documento === 'NF-3' || x.documento === 'NF-4'), false, 'tratamentos alternativos não tornam a chave LC116/NBS incompatível');

console.log('conformidade-documental: evidência, candidatos e somente leitura: OK');

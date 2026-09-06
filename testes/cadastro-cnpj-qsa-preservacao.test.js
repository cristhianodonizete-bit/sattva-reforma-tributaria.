const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-cnpj-qsa-'));
process.env.SATTVA_DADOS = pasta;
const db = require('../src/db');
const cnpj = require('../src/services/cnpjReceita');

(async () => {
  const empresaId = Number(db.prepare('INSERT INTO empresas (cnpj,razao_social,regime) VALUES (?,?,?)').run('10000000000004','Empresa QSA','lucro_real').lastInsertRowid);
  db.prepare(`INSERT INTO empresa_qsa (empresa_id,nome,documento,qualificacao,percentual_participacao,brasileiro,fonte,origem)
    VALUES (?,?,?,?,?,?,?,?)`).run(empresaId,'Sócio confirmado','11111111111','Administrador',60,1,'manual','confirmacao_manual');
  await cnpj.persistirQsaConsultado(empresaId, { fonte:'InfoSimples', qsa:[{ nome:'Sócio confirmado', documento:'11111111111', qualificacao:'Administrador', pais:'Brasil', percentual_participacao:null, brasileiro:false }, { nome:'Sócio novo', documento:'22222222222', qualificacao:'Sócio', pais:'Brasil', percentual_participacao:null, brasileiro:true }] });
  const confirmado=db.prepare('SELECT percentual_participacao,brasileiro,origem FROM empresa_qsa WHERE empresa_id=? AND nome=?').get(empresaId,'Sócio confirmado');
  assert.equal(confirmado.percentual_participacao,60);
  assert.equal(confirmado.brasileiro,1);
  assert.equal(confirmado.origem,'confirmacao_manual');
  assert.equal(db.prepare('SELECT COUNT(*) total FROM empresa_qsa WHERE empresa_id=?').get(empresaId).total,2);
  db.close(); fs.rmSync(pasta,{recursive:true,force:true});
  console.log('cadastro-cnpj-qsa-preservacao.test.js: OK');
})().catch((erro)=>{console.error(erro);process.exitCode=1;});

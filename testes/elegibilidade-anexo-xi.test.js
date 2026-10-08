const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-anexo-xi-')); process.env.SATTVA_DADOS = dir;
const db = require('../src/db');
const { classificar } = require('../src/engine/classificador');
const { naturezaAdquirente, qsaEmpresa, filtrarCandidatos } = require('../src/services/elegibilidadeAnexoXi');

db.prepare(`INSERT INTO base_servicos (lc116,nbs,descricao_item,cclasstrib,reducao) VALUES
 ('0106','115012000','Serviço Anexo XI','000001','integral'),
 ('0106','115012000','Serviço Anexo XI','200043','reduzida'),
 ('0106','115012000','Serviço Anexo XI','200044','reduzida')`).run();
const emp = db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('11111111000111','Teste','lucro_real')").run();
const empresaId = Number(emp.lastInsertRowid);
const item = { lc116:'0106', nbs:'115012000', iss:1 };
const privado = naturezaAdquirente({ codigo_natureza_juridica:'2062', natureza_juridica:'Sociedade Empresária Limitada' });
assert.equal(privado.status, 'NAO');
const autarquia = naturezaAdquirente({ codigo_natureza_juridica:'110-4', natureza_juridica:'Autarquia Federal' });
assert.equal(autarquia.status, 'SIM');
const direto = naturezaAdquirente({ codigo_natureza_juridica:'101-5', natureza_juridica:'Órgão Público do Poder Executivo Federal' });
assert.equal(direto.status, 'SIM');
assert.equal(naturezaAdquirente({ codigo_natureza_juridica:'201-1', natureza_juridica:'Empresa Pública' }).status, 'NAO');

// Hipóteses cuja condição é compra pública não podem ficar em validação para
// empresa privada conhecida, qualquer que seja o Anexo de origem.
for (const codigo of ['200005', '200008', '200011', '200040', '200043']) {
  const filtragem = filtrarCandidatos([{ cclasstrib: codigo }], { adquirente: privado });
  assert.deepEqual(filtragem.candidatos, []);
  assert.equal(filtragem.excluidos[0].codigo, codigo);
}
const filtragemTextual = filtrarCandidatos([{ cclasstrib: '209999', classificacao: 'Fornecimento adquirido por órgão da administração pública' }], { adquirente: privado });
assert.deepEqual(filtragemTextual.candidatos, []);
const semBraille = filtrarCandidatos([{ cclasstrib: '200031' }], { acessibilidade: { status: 'NAO', motivo: 'Controlador facial não é agenda em braille.' } });
assert.deepEqual(semBraille.candidatos, []);
const comBraille = filtrarCandidatos([{ cclasstrib: '200031' }], { acessibilidade: { status: 'SIM' } });
assert.equal(comBraille.candidatos[0].cclasstrib, '200031');

let r = classificar(item, { sentido:'saida', elegibilidadeAnexoXi:{ adquirente:privado, qsa:{status:'NAO',motivo:'Sem sócio elegível.'} } });
assert.equal(r.status, 'CLASSIFICADO'); assert.equal(r.cclasstrib, '000001');
db.prepare(`INSERT INTO empresa_qsa (empresa_id,nome,percentual_participacao,brasileiro) VALUES (?,?,?,?)`).run(empresaId,'Sócio brasileiro',20,1);
assert.equal(qsaEmpresa(empresaId).status,'SIM');
r = classificar(item,{sentido:'saida',elegibilidadeAnexoXi:{adquirente:privado,qsa:qsaEmpresa(empresaId)}});
assert.equal(r.status,'CLASSIFICADO');
assert.equal(r.cclasstrib,'200044');
assert.equal(r.reducao,'reduzida');
assert.equal(r.elegibilidadeAnexoXi.status_qsa,'SIM');
assert.equal(r.elegibilidadeAnexoXi.socio.percentual_participacao,20);
db.prepare('DELETE FROM empresa_qsa WHERE empresa_id=?').run(empresaId);
db.prepare(`INSERT INTO empresa_qsa (empresa_id,nome,percentual_participacao,brasileiro) VALUES (?,?,?,?)`).run(empresaId,'Sócio sem percentual',null,1);
assert.equal(qsaEmpresa(empresaId).status,'PENDENTE');
r = classificar(item,{sentido:'saida',elegibilidadeAnexoXi:{adquirente:privado,qsa:qsaEmpresa(empresaId)}});
assert.equal(r.status,'REQUER_VALIDACAO');
assert.equal(r.candidatos.some((x)=>x.cclasstrib==='200044'),true);
console.log('elegibilidade-anexo-xi: 200043/200044 condicionais: OK');
try { db.close?.(); } catch (_) {} fs.rmSync(dir,{recursive:true,force:true});

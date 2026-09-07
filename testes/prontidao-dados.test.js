const assert=require('assert'); const fs=require('fs'); const os=require('os'); const path=require('path');
const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-prontidao-')); process.env.SATTVA_DADOS=pasta;
const db=require('../src/db'); const periodo=require('../src/services/periodoAnalisado'); const prontidao=require('../src/services/prontidaoDados');
const empresa=Number(db.prepare('INSERT INTO empresas (cnpj,razao_social,regime,cnae) VALUES (?,?,?,?)').run('30000000000001','Empresa','simples_nacional','6201501').lastInsertRowid);
periodo.salvar(empresa,{competencia_inicio:'2026-01',competencia_fim:'2026-02'},'teste');
let r=prontidao.obter(empresa); assert.equal(r.motor.status,'VERMELHO'); assert.equal(r.etapas.find(x=>x.id==='documentos').status,'VERMELHO');
for(const c of ['2026-01','2026-02']) { prontidao.declarar(empresa,{tipo:'DOCUMENTOS_SEM_MOVIMENTO',referencia:c,motivo:'Sem movimento'},'teste'); prontidao.declarar(empresa,{tipo:'OUTRAS_RECEITAS_NAO_APLICAVEL',referencia:c,motivo:'Não se aplica'},'teste'); }
r=prontidao.obter(empresa); assert.equal(r.motor.status,'VERDE'); assert.equal(r.motor.liberado,true);
prontidao.declarar(empresa,{tipo:'APURACAO_HISTORICO_NAO_APLICAVEL',referencia:'2024',motivo:'Empresa nova'},'teste');
assert.throws(()=>prontidao.declarar(empresa,{tipo:'DOCUMENTOS_SEM_MOVIMENTO',referencia:'2026-13',motivo:'x'}),/Referência/);
db.close(); fs.rmSync(pasta,{recursive:true,force:true}); console.log('prontidao-dados.test.js: OK');

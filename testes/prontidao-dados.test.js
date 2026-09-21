const assert=require('assert'); const fs=require('fs'); const os=require('os'); const path=require('path');
const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-prontidao-')); process.env.SATTVA_DADOS=pasta;
const db=require('../src/db'); const periodo=require('../src/services/periodoAnalisado'); const prontidao=require('../src/services/prontidaoDados');
const empresa=Number(db.prepare('INSERT INTO empresas (cnpj,razao_social,regime,cnae) VALUES (?,?,?,?)').run('30000000000001','Empresa','simples_nacional','6201501').lastInsertRowid);
periodo.salvar(empresa,{competencia_inicio:'2026-01',competencia_fim:'2026-02'},'teste');
let r=prontidao.obter(empresa); assert.equal(r.motor.status,'VERMELHO'); assert.equal(r.etapas.find(x=>x.id==='documentos').status,'VERMELHO');
prontidao.declarar(empresa,{tipo:'DOCUMENTOS_SEM_MOVIMENTO',referencia:'2026',motivo:'Sem movimento'},'teste');
prontidao.declarar(empresa,{tipo:'OUTRAS_RECEITAS_NAO_APLICAVEL',referencia:'2026',motivo:'Não se aplica'},'teste');
r=prontidao.obter(empresa); assert.equal(r.motor.status,'VERDE'); assert.equal(r.motor.liberado,true);
prontidao.declarar(empresa,{tipo:'APURACAO_HISTORICO_NAO_APLICAVEL',referencia:'2024',motivo:'Empresa nova'},'teste');
prontidao.declarar(empresa,{tipo:'APURACAO_HISTORICO_NAO_APLICAVEL',referencia:'2026-01',motivo:'Sem movimento'},'teste');
assert.ok(!prontidao.obter(empresa).etapas.find(x=>x.id==='apuracoes').pendencias.some(x=>x.includes('2026-01')));
const inserirPgdas=db.prepare("INSERT INTO pgdas_documentos (empresa_id,nome_original,tipo_documento,conteudo_original,hash_sha256,competencia_detectada,data_processamento,metodo_extracao,status_processamento) VALUES (?,?,?,?,?,?,?,?,?)");
for(let ano=2025, mes=3; ano<2026 || mes<=2;){ const competencia=`${ano}-${String(mes).padStart(2,'0')}`; inserirPgdas.run(empresa,`PGDAS-${competencia}.pdf`,'PDF',Buffer.from('teste'),`hash-${competencia}`,competencia,new Date().toISOString(),'TESTE','VALIDADO_USUARIO'); mes++; if(mes===13){mes=1;ano++;} }
assert.equal(prontidao.obter(empresa).etapas.find(x=>x.id==='apuracoes').status,'VERDE','PGDAS confirmado é a fonte da prontidão, mesmo sem Perfil materializado');
db.prepare("UPDATE pgdas_documentos SET status_processamento='VALIDADO_AUTOMATICAMENTE' WHERE empresa_id=? AND competencia_detectada='2026-01'").run(empresa);
assert.ok(prontidao.obter(empresa).etapas.find(x=>x.id==='apuracoes').cobertas.includes('2026-01'),'PGDAS validado automaticamente também cobre a competência na prontidão');
assert.throws(()=>prontidao.declarar(empresa,{tipo:'DOCUMENTOS_SEM_MOVIMENTO',referencia:'2026-13',motivo:'x'}),/Referência/);
db.close(); fs.rmSync(pasta,{recursive:true,force:true}); console.log('prontidao-dados.test.js: OK');

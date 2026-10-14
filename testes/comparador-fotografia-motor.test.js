const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-comparador-fotografia-'));
process.env.SATTVA_DADOS=dir;
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const db=require('../src/db');
const {compararFotografiaMotor}=require('../src/services/operacaoCompartilhada');
const resultado={id:10,movimento_id:20,preco_atual:100,base_economica:90,cbs:8.25,ibs:0,credito_cbs:1.5,status_classificacao:'CLASSIFICADO',status_credito:'DETERMINADO'};
const estado={movimento_id:20,situacao:'ATUAL',assinatura_origem:'abc',versao_origem:3};
try {
  const colunas=db.prepare('PRAGMA table_info(projecoes_movimentos_estado)').all().map((x)=>x.name);
  assert.ok(colunas.includes('assinatura_origem') && colunas.includes('versao_origem'),'schema de estado deve conter assinatura e versão de origem');
  assert.equal(compararFotografiaMotor({resultadosRemotos:[resultado],resultadosLocais:[{...resultado}],estadosRemotos:[estado],estadosLocais:[{...estado}]}).ok,true,'fotografias idênticas devem validar');
  assert.equal(compararFotografiaMotor({resultadosRemotos:[resultado],resultadosLocais:[{...resultado,cbs:'8.2500005'}],estadosRemotos:[estado],estadosLocais:[{...estado,versao_origem:'3.0000005'}]}).ok,true,'diferenças numéricas inferiores a 1e-6 devem validar');
  const ausente=compararFotografiaMotor({resultadosRemotos:[resultado],resultadosLocais:[],estadosRemotos:[estado],estadosLocais:[estado]});
  assert.equal(ausente.ok,false); assert.equal(ausente.amostra[0].tipo,'RESULTADO_AUSENTE_LOCAL');
  const divergente=compararFotografiaMotor({resultadosRemotos:[resultado],resultadosLocais:[{...resultado,cbs:9}],estadosRemotos:[estado],estadosLocais:[estado]});
  assert.equal(divergente.ok,false); assert.ok(divergente.amostra.some((x)=>x.tipo==='RESULTADO_DIVERGENTE' && x.campo==='cbs'));
  const estadoDivergente=compararFotografiaMotor({resultadosRemotos:[resultado],resultadosLocais:[resultado],estadosRemotos:[estado],estadosLocais:[{...estado,versao_origem:4}]});
  assert.equal(estadoDivergente.ok,false); assert.ok(estadoDivergente.amostra.some((x)=>x.tipo==='ESTADO_DIVERGENTE' && x.campo==='versao_origem'));
  console.log('comparador-fotografia-motor: idêntico, ausente, valor e versão de estado: OK');
} finally { db.close(); fs.rmSync(dir,{recursive:true,force:true}); }

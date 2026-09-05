const assert=require('assert'),express=require('express'),fs=require('fs'),os=require('os'),path=require('path');
const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-e2e-id-'));process.env.SATTVA_DADOS=pasta;
const db=require('../src/db');require('../src/services/operacaoCompartilhada').publicar=async()=>({teste:true});
const router=require('../src/routes/api');
async function main(){
 const a=db.prepare("insert into empresas(cnpj,razao_social) values(?,?)").run('11111111000111','Empresa E2E A').lastInsertRowid;
 const b=db.prepare("insert into empresas(cnpj,razao_social) values(?,?)").run('22222222000122','Empresa E2E B').lastInsertRowid;
 const app=express();app.use(router);const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 const post=async(url,nome,conteudo)=>{const f=new FormData();f.append('arquivos',new Blob([conteudo],{type:'text/plain'}),nome);const x=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method:'POST',body:f});return {status:x.status,body:await x.json()};};
 const xml=(cnpj,numero)=>`<NFe><infNFe Id="NFe12345678901234567890123456789012345678901234"><ide><mod>55</mod><serie>1</serie><nNF>${numero}</nNF><dhEmi>2026-05-15T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>${cnpj}</CNPJ><xNome>Emitente</xNome><enderEmit><UF>MG</UF></enderEmit></emit><dest><CNPJ>99999999000199</CNPJ><xNome>Cliente</xNome></dest><det nItem="1"><prod><cProd>PROD001</cProd><xProd>Produto E2E</xProd><NCM>99999999</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vProd>100</vProd></prod><imposto/></det><total><ICMSTot><vNF>100</vNF></ICMSTot></total></infNFe></NFe>`;
 try {
  let r=await post(`/empresas/${a}/importar/xml`,'a.xml',xml('11111111000111','1'));assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.itens,1);
  r=await post(`/empresas/${a}/importar/xml`,'a2.xml',xml('11111111000111','2'));assert.equal(r.status,200);
  const pa=db.prepare("select * from produtos_empresa where empresa_id=? and codigo_produto_atual='PROD001'").get(a);assert.ok(pa);
  assert.equal(db.prepare("select count(*) c from produtos_empresa where empresa_id=? and codigo_produto_atual='PROD001'").get(a).c,1);
  assert.equal(db.prepare("select count(*) c from produto_aliases where empresa_id=? and tipo_origem='XML_CPROD' and codigo_origem='PROD001'").get(a).c,1);
  assert.equal(db.prepare("select count(*) c from movimentos where empresa_id=? and produto_empresa_id=?").get(a,pa.id).c,2);
  r=await post(`/empresas/${b}/importar/xml`,'b.xml',xml('22222222000122','1'));assert.equal(r.status,200);const pb=db.prepare("select * from produtos_empresa where empresa_id=? and codigo_produto_atual='PROD001'").get(b);assert.ok(pb);assert.notEqual(pa.id,pb.id);
  const sped='|0000|015|0|01012026|31012026|Empresa E2E A|11111111000111||MG|\n|0200|ITEM001|Produto SPED|||UN|00|99999999|||\n|C100|1|0|PART|55|00|1|1|123|15052026||100||||100|\n|C170|1|ITEM001|Produto SPED|1|UN|100|0||00|5102||100||0|||0||||||0||||||0|\n';
  r=await post(`/empresas/${a}/importar/sped`,'teste.txt',sped);assert.equal(r.status,200);const ps=db.prepare("select * from produtos_empresa where empresa_id=? and codigo_produto_atual='ITEM001'").get(a);assert.ok(ps);assert.equal(db.prepare("select count(*) c from produto_aliases where empresa_id=? and tipo_origem='SPED_COD_ITEM' and codigo_origem='ITEM001'").get(a).c,1);assert.ok(db.prepare('select 1 from movimentos where empresa_id=? and produto_empresa_id=?').get(a,ps.id));
  console.log('e2e-identidade-importadores: XML, recorrência, empresas e SPED aprovados');
 } finally {await new Promise((r,j)=>server.close(e=>e?j(e):r()));db.close();fs.rmSync(pasta,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});

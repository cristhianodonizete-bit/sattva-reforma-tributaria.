const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-sombra-reuso-'));process.env.SATTVA_DADOS=pasta;
const db=require('../src/db');
const { comparar }=require('../src/services/sombraReusoClassificacao');
const empresa={ id:Number(db.prepare("INSERT INTO empresas(cnpj,razao_social,regime) VALUES('77777777000177','Sombra','lucro_presumido')").run().lastInsertRowid), regime:'lucro_presumido' };
const contexto={ empresa, sentido:'saida', ano:2027, regimeContraparte:null, perfilDestinatario:'pessoa_fisica', elegibilidadeAnexoXi:{ adquirente:{status:'NAO'},qsa:{status:'NAO'} } };
const comum={ cfop:'5102',ncm:'30049099',valor:100,icms:18,pis:0.65,cofins:3,quantidade:1,descricao:'Produto',documento:'1',item_numero:1 };
const r=comparar([
  {movimento_id:1,item:comum,contexto},
  {movimento_id:2,item:{...comum,valor:250,documento:'2',item_numero:1},contexto},
  {movimento_id:3,item:{...comum,cfop:'5405',valor:300,documento:'3'},contexto},
  {movimento_id:4,item:{...comum,documento:'4',declarado:{ibs:1,cbs:2}},contexto},
]);
assert.equal(r.aprovado,true);assert.equal(r.divergencias,0);assert.equal(r.contextos,3);assert.equal(r.reusos,1);
console.log('sombra-reuso-classificacao: equivalência por item e isolamento de contexto: OK');db.close();fs.rmSync(pasta,{recursive:true,force:true});

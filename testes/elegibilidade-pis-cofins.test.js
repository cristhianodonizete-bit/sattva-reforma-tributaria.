const assert=require('assert');
const db=require('../src/db');
const elegibilidade=require('../src/services/elegibilidadeCreditoPisCofins');

const empresa=db.prepare("INSERT INTO empresas (cnpj,razao_social,regime,regime_resolvido,cnae,atividade) VALUES (?,?,?,?,?,?)")
  .run('99999999000191','Empresa de teste','lucro_real','lucro_real','2222-6/00','Fabricação de embalagens de papel').lastInsertRowid;
const inserir=db.prepare("INSERT INTO movimentos (empresa_id,tipo,sentido,descricao,ncm,competencia,valor,documento,modelo_documento_fiscal) VALUES (?,?,?,?,?,?,?,?,?)");
inserir.run(empresa,'cliente','saida','Embalagem de papel','48191000','2026-01',100,'1/1','nfe');
inserir.run(empresa,'fornecedor','entrada','Embalagem de papel','48191000','2026-01',50,'1/2','nfe');
inserir.run(empresa,'fornecedor','entrada','Multa contratual','','2026-01',20,'1/3','nfe');
const resultado=elegibilidade.listar(empresa);
assert.equal(resultado.itens.find((x)=>x.documento==='1/2').status,'ELEGIVEL_COM_EVIDENCIA');
assert.equal(resultado.itens.find((x)=>x.documento==='1/3').status,'NAO_ELEGIVEL');
console.log('elegibilidade-pis-cofins.test: vínculo com saída, CNAE e bloqueios classificados sem criar crédito.');

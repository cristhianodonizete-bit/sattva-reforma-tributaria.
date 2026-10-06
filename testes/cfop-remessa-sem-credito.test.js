const assert=require('assert');
const fs=require('fs'); const os=require('os'); const path=require('path');
process.env.SATTVA_DADOS=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-cfop-remessa-'));
const { classificar }=require('../src/engine/classificador');
const { avaliarCredito }=require('../src/engine/motor');

// A mesma família não pode virar aquisição quando aparece como entrada
// (1/2.xxx). O primeiro dígito indica a origem/destino, não uma compra.
for (const cfop of ['1901','1915','1925','2901','2915','2925','5901','5915','5925','6901','6915','6925']) {
  const classificacao=classificar({ cfop, ncm:'84798999', descricao:'Bem remetido' },{ sentido:'entrada' });
  assert.equal(classificacao.status,'CLASSIFICADO',cfop);
  assert.equal(classificacao.semCreditoPorCfop,true,cfop);
  assert.match(classificacao.fundamentos.join(' '),/não gera crédito/i,cfop);
  const credito=avaliarCredito({ regimeAdquirente:'lucro_real',regimeFornecedor:'lucro_real',cls:classificacao,sentido:'entrada' });
  assert.equal(credito.status,'SEM_DIREITO',cfop);
  assert.equal(credito.statusDeterminacao,'DETERMINADO',cfop);
}
console.log('cfop-remessa-sem-credito.test.js: OK');

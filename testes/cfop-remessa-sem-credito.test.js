const assert=require('assert');
const fs=require('fs'); const os=require('os'); const path=require('path');
process.env.SATTVA_DADOS=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-cfop-remessa-'));
const { classificar }=require('../src/engine/classificador');
const { avaliarCredito }=require('../src/engine/motor');

const classificacao=classificar({ cfop:'5915', ncm:'84798999', descricao:'Catraca eletrônica para conserto' },{ sentido:'entrada' });
assert.equal(classificacao.status,'CLASSIFICADO');
assert.equal(classificacao.semCreditoPorCfop,true);
assert.match(classificacao.fundamentos.join(' '),/não gera crédito/i);

const credito=avaliarCredito({ regimeAdquirente:'lucro_real',regimeFornecedor:'lucro_real',cls:classificacao,sentido:'entrada' });
assert.equal(credito.status,'SEM_DIREITO');
assert.equal(credito.statusDeterminacao,'DETERMINADO');
console.log('cfop-remessa-sem-credito.test.js: OK');

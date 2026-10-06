const assert=require('assert');
const fs=require('fs'); const os=require('os'); const path=require('path');
process.env.SATTVA_DADOS=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-razao-xml-'));
const { documentosEquivalentesRazao }=require('../src/services/motorExec');

const xml={ documento:'26000/2600000033651',data_emissao:'2026-02-18',valor:14114.32 };
const razao={ documento:'33651',competencia:'2026-02',valor:14114.32 };
assert.equal(documentosEquivalentesRazao(razao,xml),true,'número final + valor + competência identifica a mesma nota');
assert.equal(documentosEquivalentesRazao({...razao,valor:14114.20},xml),false,'valor divergente não pode ser conciliado');
assert.equal(documentosEquivalentesRazao({...razao,documento:'33652'},xml),false,'número divergente não pode ser conciliado');
console.log('razao-xml-duplicidade.test.js: OK');

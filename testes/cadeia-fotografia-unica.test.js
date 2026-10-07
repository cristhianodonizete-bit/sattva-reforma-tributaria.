const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const fonte=fs.readFileSync(path.join(__dirname,'../src/services/consolidacaoOficial.js'),'utf8');

assert.match(fonte,/detalhe\.regimeEmitente \|\| x\.regime_cbs_emitente/, 'regime exibido deve ser o da fotografia do motor');
assert.match(fonte,/detalhe\.contraparte \|\| x\.parceiro_cadastrado/, 'nome exibido deve preferir a fotografia do motor');
assert.match(fonte,/não pode combinar o cadastro vivo com o cálculo/, 'a regra de fonte única deve estar explícita');
console.log('cadeia-fotografia-unica: apresentação usa somente a fotografia do cálculo.');

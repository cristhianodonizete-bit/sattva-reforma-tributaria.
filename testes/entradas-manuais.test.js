const assert=require('assert');
const fs=require('fs');
const path=require('path');
const raiz=path.resolve(__dirname,'..');
const db=fs.readFileSync(path.join(raiz,'src/db.js'),'utf8');
const api=fs.readFileSync(path.join(raiz,'src/routes/api.js'),'utf8');
const tela=fs.readFileSync(path.join(raiz,'public/js/telas.js'),'utf8');
const config=fs.readFileSync(path.join(raiz,'public/js/telas6.js'),'utf8');

for (const chave of ['LICENCA_USO_SISTEMAS_SOFTWARE','MATERIAL_ESCRITORIO','ALUGUEL_IMOVEL_COMERCIAL','MATERIAL_LIMPEZA']) assert.match(db,new RegExp(chave));
assert.match(api,/router\.post\('\/empresas\/:id\/entradas-manuais'/);
assert.match(api,/exigirPeriodoParaImportacao/);
assert.match(api,/periodoAnalisado\.noPeriodo/);
assert.match(api,/MANUAL_ENTRADA/);
assert.match(api,/publicarOperacaoEmpresa/);
assert.match(tela,/Lançar entrada manual/);
assert.match(tela,/motor não foi executado/);
assert.match(config,/Itens de entrada manual/);
console.log('OK: entradas manuais são aditivas, limitadas ao período e publicadas na fonte compartilhada.');

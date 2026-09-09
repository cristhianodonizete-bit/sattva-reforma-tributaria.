const assert=require('assert');
const receita=require('../src/services/receitaOperacional');

assert.equal(receita.compoeReceita({tipo:'cliente',sentido:'saida',cfop:'5102'}),true,'venda CFOP deve compor receita');
assert.equal(receita.compoeReceita({tipo:'cliente',sentido:'saida',cfop:'5901'}),false,'remessa não pode compor receita');
assert.equal(receita.compoeReceita({tipo:'cliente',sentido:'saida',cfop:'5202'}),false,'devolução não pode compor receita');
assert.equal(receita.compoeReceita({tipo:'cliente',sentido:'saida',cfop:'5152'}),false,'transferência não pode compor receita');
assert.equal(receita.compoeReceita({tipo:'cliente',sentido:'saida',nbs:'115013000'}),true,'NFS-e de serviço sem CFOP deve compor receita');
assert.equal(receita.compoeReceita({tipo:'cliente',sentido:'saida',modelo_documento_fiscal:'nfse'}),true,'modelo NFS-e de saída deve ser serviço faturável');
assert.equal(receita.compoeReceita({tipo:'cliente',sentido:'saida',modelo_documento_fiscal:'nfe',nbs:'115013000'}),false,'NF-e sem CFOP de venda não pode virar serviço por inferência');
assert.equal(receita.compoeReceita({tipo:'cliente',sentido:'saida',origem:'xml',lc116:'0106',cst:'060'}),false,'XML sem modelo não pode compor receita por resíduo de serviço');
assert.equal(receita.compoeReceita({tipo:'fornecedor',sentido:'entrada',cfop:'1102'}),false,'entrada não pode compor receita');
console.log('receita-operacional.test.js: OK');

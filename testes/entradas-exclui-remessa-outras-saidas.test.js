const assert=require('assert');
const fs=require('fs'); const os=require('os'); const path=require('path');
process.env.SATTVA_DADOS=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-entradas-cfop-'));
const { foraDaComposicaoDeEntradas }=require('../src/services/receitaOperacional');
const { filtrarLinhasDoEscopo }=require('../src/services/consolidacaoOficial');

const entrada=(cfop, extra={}) => ({ sentido:'entrada', tipo:'fornecedor', origem:'xml', modelo_documento_fiscal:'nfe', cfop, ...extra });

// Remessas (901–925 em 5 e 6) saem da composição de entradas pelo Mapa.
for (const cfop of ['5901','5915','5925','6901','6915','6925']) {
  assert.equal(foraDaComposicaoDeEntradas(entrada(cfop)), true, `remessa ${cfop} deve sair da composição`);
}
// Retorno de remessa para conserto (5916/6916) continua fora.
for (const cfop of ['5916','6916']) assert.equal(foraDaComposicaoDeEntradas(entrada(cfop)), true, `retorno ${cfop}`);
// Outras saídas 5949/6949 saem da composição.
for (const cfop of ['5949','6949']) assert.equal(foraDaComposicaoDeEntradas(entrada(cfop)), true, `outra saída ${cfop}`);
// CFOP de compra, devolução e transferência de entrada não são afetados.
for (const cfop of ['1102','2102','5102','6102','5202','5151','5556']) {
  assert.equal(foraDaComposicaoDeEntradas(entrada(cfop)), false, `${cfop} deve permanecer na composição`);
}
// Campo efetivo do Questor prevalece na classificação, sem alterar o XML.
assert.equal(foraDaComposicaoDeEntradas(entrada('5102', { normalizacao_evidencia:JSON.stringify({ cfop_efetivo:'5949' }) })), true, 'CFOP efetivo 5949 deve prevalecer');
// Mesmo código fora da família 949 não é removido por outra regra.
assert.equal(foraDaComposicaoDeEntradas(entrada('1949')), false, '1949 não é o caso 5949/6949');

// A consolidação de fornecedores também descarta as linhas já materializadas.
const consolidadas=filtrarLinhasDoEscopo([
  entrada('5949', { movimento_id:1 }),
  entrada('5901', { movimento_id:2 }),
  entrada('1102', { movimento_id:3 }),
], 'fornecedor');
assert.deepEqual(consolidadas.map((x)=>x.movimento_id), [3], 'consolidação de fornecedor não pode agregar remessa ou 5949');
console.log('entradas-exclui-remessa-outras-saidas.test.js: OK');

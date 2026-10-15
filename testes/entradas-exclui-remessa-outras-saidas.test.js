const assert=require('assert');
const fs=require('fs'); const os=require('os'); const path=require('path');
process.env.SATTVA_DADOS=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-entradas-cfop-'));
const { foraDaComposicaoDeEntradas }=require('../src/services/receitaOperacional');
const consolidacaoOficial=require('../src/services/consolidacaoOficial');
const { filtrarLinhasDoEscopo }=consolidacaoOficial;

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

// Fotografia antiga: a leitura do motor não pode reintroduzir a remessa ou
// outras saídas como compra/crédito, sem apagar seus documentos de origem.
const db=require('../src/db');
const motorExec=require('../src/services/motorExec');
const empresaId=Number(db.prepare("INSERT INTO empresas(cnpj,razao_social) VALUES (?,?)").run('00999999000191','Fixture CFOP').lastInsertRowid);
const execucaoId=Number(db.prepare("INSERT INTO motor_execucoes(empresa_id,ano,resumo) VALUES (?,?,?)").run(empresaId,2027,'{}').lastInsertRowid);
const inserirMovimento=db.prepare("INSERT INTO movimentos(empresa_id,tipo,sentido,origem,cfop,valor) VALUES (?,?,?,?,?,?)");
const inserirResultado=db.prepare("INSERT INTO motor_resultados(empresa_id,movimento_id,execucao_id,sentido,preco_atual,base_economica,credito_ibs,credito_cbs,detalhe) VALUES (?,?,?,?,?,?,?,?,?)");
const inserirEstado=db.prepare("INSERT INTO projecoes_movimentos_estado(empresa_id,movimento_id,assinatura_origem,situacao) VALUES (?,?,?,?)");
const movimentosPorCfop=new Map();
for (const [cfop,valor] of [['5901',100],['5949',200],['1102',300]]) {
  const movimentoId=Number(inserirMovimento.run(empresaId,'fornecedor','entrada','xml',cfop,valor).lastInsertRowid);
  movimentosPorCfop.set(cfop,movimentoId);
  inserirResultado.run(empresaId,movimentoId,execucaoId,'entrada',valor,valor,10,20,JSON.stringify({sentido:'entrada',precoAtual:valor,baseEconomica:valor,creditoIbs:10,creditoCbs:20,credito:{status:'ELEGIVEL'}}));
  inserirEstado.run(empresaId,movimentoId,`fixture-${cfop}`,'ATUAL');
}
db.prepare("INSERT INTO fotografia_oficial(empresa_id,execucao_id,empresa_remota_id,execucao_remota_id,quantidade_resultados,quantidade_estados,sincronizado_em) VALUES (?,?,?,?,?,?,datetime('now'))")
  .run(empresaId,execucaoId,empresaId,execucaoId,3,3);
const foto=motorExec.resultadoMaterializado(db.prepare('SELECT * FROM empresas WHERE id=?').get(empresaId));
assert.deepEqual(foto.entradas.map((x)=>x.precoAtual), [300], 'fotografia deve manter somente a compra válida');
assert.equal(foto.resumo.comprasAnalisadas,300,'remessa e 5949 não podem voltar a compras');
assert.equal(foto.entradas.reduce((total,x)=>total + Number(x.creditoIbs || 0) + Number(x.creditoCbs || 0),0),30,'remessa e 5949 não podem voltar a crédito');

// A tela de cadeia usa a consolidação SQL persistida, não a lista em memória.
// Ela precisa aplicar o mesmo Mapa de CFOP a fotografias antigas.
const cadeia=consolidacaoOficial.cadeia(empresaId,'fornecedor');
assert.equal(cadeia.totais.registros,1,'cadeia SQL deve contar apenas a compra válida');
assert.equal(cadeia.totais.valor,300,'cadeia SQL não pode somar remessa ou 5949 em compras');
assert.equal(cadeia.totais.baseEconomica,300,'cadeia SQL não pode somar remessa ou 5949 na base econômica');
assert.equal(cadeia.totais.creditoFinal,30,'cadeia SQL não pode somar crédito de remessa ou 5949');
assert.deepEqual(cadeia.detalhes.map((x)=>x.movimento_id),[movimentosPorCfop.get('1102')],'remessas seguem rastreáveis fora da cadeia, mas não aparecem nas operações econômicas');
console.log('entradas-exclui-remessa-outras-saidas.test.js: OK');

const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-questor-locacoes-'));
const { lerLocacoesQuestor } = require('../src/routes/conectorQuestor');

const retorno = JSON.stringify({ Data: `
  11001 REC 30/06/2026 9000010 Locação de Bens/Serviços LORENA OLIVEIRA 4.370,01
  11002 REC 30/06/2026 9000011 Aluguel de imóvel comercial CLIENTE TESTE 2.000,00
  11003 DES 30/06/2026 9000012 Locação de máquina CLIENTE TESTE 500,00
` });
const linhas = lerLocacoesQuestor(retorno);
assert.strictEqual(linhas.length, 2);
assert.deepStrictEqual(linhas.map((x) => ({ id:x.identificador_origem, competencia:x.competencia, item:x.item_receita_chave, valor:x.valor })), [
  { id:'11001', competencia:'2026-06', item:'LOCACAO_BENS_MOVEIS', valor:4370.01 },
  { id:'11002', competencia:'2026-06', item:'ALUGUEL_IMOVEIS_PROPRIOS', valor:2000 },
]);
const estruturadas=lerLocacoesQuestor({ Registros:[
  { NrLcto:11004, Especie:'REC', DataLancamento:'30/06/2026', Descricao:'Locação de máquina', ValorContabil:'1.500,00' },
  { NrLcto:11005, Especie:'DES', DataLancamento:'30/06/2026', Descricao:'Locação de máquina', ValorContabil:'1.500,00' },
] });
assert.deepStrictEqual(estruturadas.map((x)=>({id:x.identificador_origem,item:x.item_receita_chave,valor:x.valor})), [{id:'11004',item:'LOCACAO_BENS_MOVEIS',valor:1500}]);
const relatorioGrafico = JSON.stringify({ Data: `
  Período: 01/01/2026 a 31/07/2026
  38240    31/01       10946-10956        REC        7771519    99  9.000.01 BA   ISS      0     4.245,02          0,00         0,00         0,00   4.245,02
     Natureza: 9.000.010 - Locação de Bens/Serviços
  38902    30/06       11001-11011        REC        124        99  9.000.01 MG   ISS      0     4.370,01      4.370,01         0,00         0,00       0,00
     Natureza: 9.000.010 - Locação de Bens/Serviços
` });
const doGrafico = lerLocacoesQuestor(relatorioGrafico);
assert.deepStrictEqual(doGrafico.map((x)=>({id:x.identificador_origem,competencia:x.competencia,item:x.item_receita_chave,valor:x.valor})), [
  {id:'38240',competencia:'2026-01',item:'LOCACAO_BENS_MOVEIS',valor:4245.02},
  {id:'38902',competencia:'2026-06',item:'LOCACAO_BENS_MOVEIS',valor:4370.01},
]);
console.log('Questor: REC e descrição classificam locações em outras receitas.');

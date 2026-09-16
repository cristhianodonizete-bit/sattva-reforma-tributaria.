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
console.log('Questor: REC e descrição classificam locações em outras receitas.');

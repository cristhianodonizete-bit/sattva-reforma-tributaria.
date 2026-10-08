const assert = require('node:assert/strict');
const { diagnosticarDivergenciaMovimentosCanonicos } = require('../src/services/operacaoCompartilhada');

const movimento = { id: 101, empresa_id: 9, tipo:'fornecedor', nome:'Fornecedor', valor:100, competencia:'2026-01', origem:'QUESTOR_RAZAO', chave:'QUESTOR:101', cst:'000', cclasstrib:'000001' };

// Base idêntica: o motor pode calcular, pois não há nada a reconciliar.
assert.deepEqual(diagnosticarDivergenciaMovimentosCanonicos([{ ...movimento }], [{ ...movimento }]), {
  inclusoes_ou_alteracoes:0, remocoes:0, bloqueia:false,
});

// Um valor divergente é bloqueante; a função apenas diagnostica e não escreve.
const antes = JSON.stringify([movimento]);
assert.deepEqual(diagnosticarDivergenciaMovimentosCanonicos([{ ...movimento, valor:101 }], [movimento]), {
  inclusoes_ou_alteracoes:1, remocoes:0, bloqueia:true,
});
assert.equal(JSON.stringify([movimento]), antes, 'a conferência não pode alterar fatos locais');

// Exclusão canônica também é bloqueante: o worker não pode apagar o fato.
assert.deepEqual(diagnosticarDivergenciaMovimentosCanonicos([{ ...movimento }], [{ ...movimento }], [101]), {
  inclusoes_ou_alteracoes:0, remocoes:1, bloqueia:true,
});

console.log('reconciliacao-motor-somente-leitura: divergências bloqueiam sem mutar fatos: OK');

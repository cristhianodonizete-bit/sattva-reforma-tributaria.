const assert = require('node:assert/strict');
const qualidade = require('../src/services/qualidadeCobertura');

const linha = (sobrescreve = {}) => ({
  movimento_id: 1, sentido: 'saida', preco_atual: 100, natureza: 'SIMULADO',
  status_classificacao: 'CLASSIFICADO', tratamento: 'TRIBUTADA', cbs: 9.21,
  status_credito: 'SEM_DIREITO', detalhe: { reconstrucao: { status: 'reconstruida' } },
  ...sobrescreve,
});

let avaliada = qualidade.avaliarLinha(linha());
assert.equal(avaliada.natureza_projecao, 'SIMULADO');
assert.equal(avaliada.dimensoes.resultado, qualidade.STATUS.DETERMINADO);
assert.equal(avaliada.dimensoes.ibs, qualidade.STATUS.NA);

avaliada = qualidade.avaliarLinha(linha({ detalhe: { reconstrucao: { status: 'estimada' } } }));
assert.equal(avaliada.dimensoes.reconstrucao, qualidade.STATUS.PREMISSA);
assert.equal(avaliada.dimensoes.resultado, qualidade.STATUS.PREMISSA);

avaliada = qualidade.avaliarLinha(linha({ sentido: 'entrada', cbs: 0, status_credito_determinacao: 'DETERMINADO_POR_PREMISSA' }));
assert.equal(avaliada.dimensoes.credito, qualidade.STATUS.PREMISSA);
assert.equal(avaliada.dimensoes.resultado, qualidade.STATUS.PREMISSA);

avaliada = qualidade.avaliarLinha(linha({ sentido: 'entrada', cbs: 0, status_credito_determinacao: 'SUJEITO_VALIDACAO' }));
assert.equal(avaliada.dimensoes.credito, qualidade.STATUS.VALIDACAO);
assert.equal(avaliada.dimensoes.resultado, qualidade.STATUS.VALIDACAO);

avaliada = qualidade.avaliarLinha(linha({ detalhe: { reconstrucao: { status: 'insuficiente' } } }));
assert.equal(avaliada.dimensoes.reconstrucao, qualidade.STATUS.INDETERMINADO);
assert.equal(avaliada.dimensoes.resultado, qualidade.STATUS.INDETERMINADO);

const consolidado = qualidade.consolidar([
  linha({ movimento_id: 1 }),
  linha({ movimento_id: 2, detalhe: { reconstrucao: { status: 'estimada' } } }),
  linha({ movimento_id: 3, sentido: 'entrada', status_credito_determinacao: 'DETERMINADO_POR_PREMISSA' }),
  linha({ movimento_id: 4, sentido: 'entrada', status_credito_determinacao: 'SUJEITO_VALIDACAO' }),
  linha({ movimento_id: 5, detalhe: { reconstrucao: { status: 'insuficiente' } } }),
]);
assert.equal(consolidado.natureza_projecao.SIMULADO.quantidade, 5);
assert.equal(consolidado.matrizes.ibs[qualidade.STATUS.NA].quantidade, 5);
assert.equal(consolidado.cobertura.automacao.cobertas.quantidade, 3);
assert.equal(consolidado.pendencias.operacoes_unicas, 2);
assert.equal(consolidado.pendencias.ocorrencias.some((x) => x.codigo === 'credito:SUJEITO_VALIDACAO'), true);
console.log('qualidade-cobertura: OK');

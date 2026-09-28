/*
 * Observador de reuso potencial de classificação.
 *
 * Não participa da decisão fiscal e não conserva itens, documentos ou o
 * resultado da classificação. Durante uma execução já autorizada do motor,
 * ele apenas conta quantas chamadas ao classificador teriam a mesma assinatura
 * fiscal. A chave é hasheada para que a telemetria persistida não revele dados
 * do documento nem do parceiro.
 */
const crypto = require('crypto');
const { assinaturaClassificacao } = require('./sombraReusoClassificacao');

const chave = (item, contexto) => crypto.createHash('sha256')
  .update(assinaturaClassificacao(item, contexto)).digest('hex');

function criar({ ativo = false } = {}) {
  const contextos = new Set();
  let itens = 0;
  let reusos = 0;

  function registrar(item, contexto) {
    if (!ativo) return;
    itens += 1;
    const assinatura = chave(item, contexto);
    if (contextos.has(assinatura)) reusos += 1;
    else contextos.add(assinatura);
  }

  function resumo() {
    if (!ativo) return { executada:false, motivo:'FEATURE_FLAG_DESLIGADA' };
    return {
      executada:true,
      natureza:'SOMBRA_OBSERVACIONAL_SEM_REUSO',
      itens_observados:itens,
      contextos_distintos:contextos.size,
      classificacoes_potencialmente_reutilizaveis:reusos,
      taxa_reuso_potencial:itens ? Math.round((reusos / itens) * 10000) / 100 : 0,
      // Não há uma segunda projeção: resultado oficial e fotografia continuam
      // sendo exatamente os do fluxo já existente.
      alterou_resultado_oficial:false,
      divergencias_avaliadas:0,
    };
  }

  return { registrar, resumo };
}

module.exports = { criar };

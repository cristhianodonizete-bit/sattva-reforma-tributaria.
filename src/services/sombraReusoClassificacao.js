const motor = require('../engine/motor');
const { classificar } = require('../engine/classificador');

const texto = (valor) => String(valor == null ? '' : valor).trim().toLowerCase();
const digitos = (valor) => texto(valor).replace(/\D/g, '');

// Esta assinatura contém somente dados consumidos pelo classificador. Valores
// monetários ficam fora: cada movimento ainda reconstrói sua base e calcula
// IBS/CBS/crédito individualmente.
function assinaturaClassificacao(item = {}, ctx = {}) {
  const revisao = item.revisaoBeneficio || null;
  return JSON.stringify({
    versao:'SOMBRA_REUSO_CLASSIFICACAO_V1', empresa:ctx.empresa?.id || null,
    sentido:ctx.sentido === 'saida' ? 'saida' : 'entrada',
    regime_contraparte:texto(ctx.regimeContraparte), perfil_destinatario:texto(ctx.perfilDestinatario),
    elegibilidade:ctx.elegibilidadeAnexoXi || {},
    cfop:digitos(item.cfop), ncm:digitos(item.ncm), nbs:digitos(item.nbs), lc116:digitos(item.lc116),
    modelo_documento_fiscal:texto(item.modelo_documento_fiscal), origem:texto(item.origem),
    // A declaração é evidência exibida no rastro classificatório. Mesmo não
    // vencendo a regra, valores distintos não podem compartilhar o objeto de
    // classificação sem uma adaptação explícita da memória por item.
    declarado:item.declarado ? { cst:texto(item.declarado.cst), cclasstrib:texto(item.declarado.cclasstrib),
      ibs:texto(item.declarado.ibs), cbs:texto(item.declarado.cbs) } : null,
    revisao:revisao ? { id:revisao.revisao_id || null, cclasstrib:texto(revisao.nova_cclasstrib || revisao.candidato?.cclasstrib) } : null,
  });
}

function diferencas(antes, depois) {
  const chaves = new Set([...Object.keys(antes || {}), ...Object.keys(depois || {})]);
  return [...chaves].filter((chave) => JSON.stringify(antes?.[chave]) !== JSON.stringify(depois?.[chave]));
}

/**
 * Recebe operações já normalizadas e não escreve no banco. Cada operação é
 * { movimento_id, item, contexto }. Retorna baseline e sombra por item.
 */
function comparar(operacoes = []) {
  const cache = new Map();
  const itens = [];
  for (const operacao of operacoes) {
    const item = operacao.item || {};
    const contexto = operacao.contexto || {};
    const oficial = motor.projetarItem(item, contexto);
    const chave = assinaturaClassificacao(item, contexto);
    let classificacao = cache.get(chave);
    if (!classificacao) {
      classificacao = classificar(item, {
        empresa:contexto.empresa, sentido:contexto.sentido,
        regimeContraparte:contexto.regimeContraparte, perfilDestinatario:contexto.perfilDestinatario,
        elegibilidadeAnexoXi:contexto.elegibilidadeAnexoXi,
      });
      cache.set(chave, structuredClone(classificacao));
    }
    const sombra = motor.projetarItem(item, { ...contexto, classificacaoPrecalculada:classificacao });
    itens.push({ movimento_id:operacao.movimento_id || null, assinatura:chave,
      divergencias:diferencas(oficial, sombra), oficial, sombra });
  }
  const divergentes = itens.filter((item) => item.divergencias.length);
  return {
    natureza:'SOMBRA_SEM_PERSISTENCIA', itens:itens.length, contextos:cache.size,
    reusos:Math.max(0, itens.length - cache.size), divergencias:divergentes.length,
    aprovado:divergentes.length === 0, resultados:itens,
  };
}

module.exports = { assinaturaClassificacao, comparar };

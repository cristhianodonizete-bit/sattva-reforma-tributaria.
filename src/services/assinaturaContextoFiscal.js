const texto = (valor) => String(valor == null ? '' : valor).trim().toLowerCase();

/**
 * Assinatura conservadora para medir reuso de classificação/regra.
 *
 * Não identifica produto, não soma valores e não substitui o cálculo por item.
 * A presença de uma revisão humana torna o movimento exclusivo por segurança.
 */
function campos(movimento = {}) {
  const revisao = Boolean(movimento.tem_revisao_beneficio);
  return {
    versao: 'CONTEXTO_FISCAL_V1',
    competencia: texto(movimento.competencia),
    sentido: texto(movimento.sentido || movimento.tipo),
    modelo_documento_fiscal: texto(movimento.modelo_documento_fiscal),
    cfop: texto(movimento.cfop).replace(/\D/g, ''),
    ncm: texto(movimento.ncm).replace(/\D/g, ''),
    nbs: texto(movimento.nbs).replace(/\D/g, ''),
    lc116: texto(movimento.lc116).replace(/\D/g, ''),
    cst: texto(movimento.cst),
    csosn: texto(movimento.csosn),
    cst_pis: texto(movimento.cst_pis),
    cst_cofins: texto(movimento.cst_cofins),
    regime_contraparte: texto(movimento.regime_cadastro || movimento.regime),
    perfil_contraparte: texto(movimento.perfil_cadastro || movimento.perfil_economico),
    cnpj_contraparte: texto(movimento.inscr_federal).replace(/\D/g, ''),
    evidencia_pis_cofins: texto(movimento.origem_evidencia_pis_cofins),
    revisao_beneficio: revisao ? `movimento:${Number(movimento.id) || 0}` : '',
  };
}

function assinatura(movimento) { return JSON.stringify(campos(movimento)); }

function agrupar(movimentos = []) {
  const grupos = new Map();
  for (const movimento of movimentos) {
    const chave = assinatura(movimento);
    const grupo = grupos.get(chave) || { assinatura:chave, contexto:campos(movimento), itens:0, valor:0, movimento_ids:[] };
    grupo.itens += 1;
    grupo.valor += Number(movimento.valor) || 0;
    grupo.movimento_ids.push(Number(movimento.id));
    grupos.set(chave, grupo);
  }
  return [...grupos.values()].sort((a, b) => b.itens - a.itens || b.valor - a.valor);
}

function resumo(movimentos = []) {
  const grupos = agrupar(movimentos);
  const itens = movimentos.length;
  const contextos = grupos.length;
  const chamadasEvitaveis = Math.max(0, itens - contextos);
  return {
    itens,
    contextos,
    chamadas_classificacao_e_regra_atuais:itens,
    chamadas_classificacao_e_regra_estimadas:contextos,
    chamadas_evitaveis:chamadasEvitaveis,
    reducao_percentual:itens ? Math.round(chamadasEvitaveis / itens * 10000) / 100 : 0,
    grupos_reutilizaveis:grupos.filter((grupo) => grupo.itens > 1).length,
    grupos,
  };
}

module.exports = { campos, assinatura, agrupar, resumo };

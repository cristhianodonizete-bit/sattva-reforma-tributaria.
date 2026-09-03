/**
 * Conformidade documental: leitura da qualidade de emissão dos documentos.
 *
 * Não chama o motor, não reclassifica e não grava nos movimentos. Apenas
 * compara LC 116/NBS já importados com o catálogo versionado para entregar
 * evidência e orientação operacional ao usuário.
 */
const db = require('../db');
const bases = require('./basesReforma');

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;

function candidato(linha) {
  return {
    lc116: linha.lc116 || null,
    nbs: linha.nbs || null,
    descricao_lc116: linha.descricao_item || null,
    descricao_nbs: linha.descricao_nbs || null,
    // O catálogo de serviços atualmente não possui CST próprio. Não há
    // inferência por memória: a ausência é declarada para revisão do catálogo.
    cst: linha.cst || null,
    cclasstrib: linha.cclasstrib || null,
    tratamento: linha.nome_cclasstrib || linha.reducao || 'Não informado',
    reducao: linha.reducao || 'integral',
    regra: linha.regra_precedencia || linha.condicao_cumulatividade || null,
    fundamento: linha.fundamento_cumulatividade || null,
  };
}

function regraDeUso(x) {
  const partes = [
    x.lc116 && `Use quando o serviço corresponder ao item LC 116 ${x.lc116}.`,
    x.nbs && `Confirme o NBS ${x.nbs} pela descrição efetiva do serviço.`,
    x.regra && x.regra,
    x.fundamento && `Fundamento registrado: ${x.fundamento}.`,
  ].filter(Boolean);
  return partes.join(' ');
}

function avaliar(movimento) {
  const lc116 = bases.normLc116(movimento.lc116);
  const nbs = bases.normNbs(movimento.nbs);
  if (!lc116 && !nbs) return null;
  const consulta = bases.consultarServico(lc116, nbs);
  const candidatos = (consulta.candidatos || []).map(candidato).map((x) => ({ ...x, regra_uso: regraDeUso(x) }));

  if (lc116 && !nbs) return {
    tipo: 'LC116_SEM_NBS', severidade: 'ATENCAO',
    titulo: 'Omissão de NBS no documento fiscal',
    evidencia: `O lançamento informa LC 116 ${lc116}, mas não informa NBS.`,
    solucao: candidatos.length
      ? 'Confirme a descrição efetiva do serviço e informe o NBS compatível dentre as opções apresentadas.'
      : 'Complete o NBS e revise a correspondência no catálogo fiscal.',
    candidatos,
  };
  if (!lc116 && nbs) return {
    tipo: 'NBS_SEM_LC116', severidade: 'ATENCAO',
    titulo: 'Omissão de LC 116 no documento fiscal',
    evidencia: `O lançamento informa NBS ${nbs}, mas não informa o item LC 116.`,
    solucao: candidatos.length
      ? 'Confirme o item da lista de serviços aplicável dentre as opções apresentadas.'
      : 'Complete o item LC 116 e revise a correspondência no catálogo fiscal.',
    candidatos,
  };
  if (!consulta.encontrado) return {
    tipo: 'LC116_NBS_SEM_CORRESPONDENCIA', severidade: 'ATENCAO',
    titulo: 'LC 116 e NBS sem correspondência no catálogo',
    evidencia: `A combinação LC 116 ${lc116} + NBS ${nbs} não foi localizada no catálogo fiscal.`,
    solucao: 'Confira os dois códigos no documento e, se estiverem corretos, solicite a inclusão da correlação no catálogo fiscal.',
    candidatos: [],
  };
  if (consulta.nivel !== 'exato') return {
    tipo: 'LC116_NBS_INCOMPATIVEIS', severidade: 'ALTA',
    titulo: 'LC 116 e NBS incompatíveis no documento fiscal',
    evidencia: `A combinação LC 116 ${lc116} + NBS ${nbs} não existe como chave composta no catálogo. As referências foram encontradas separadamente, mas não como o mesmo serviço.`,
    solucao: 'Revise a descrição do serviço e utilize a combinação LC 116/NBS compatível apresentada abaixo.',
    candidatos,
  };
  return null;
}

function listar(empresaId) {
  const movimentos = db.prepare(`SELECT id,empresa_id,tipo,nome,inscr_federal,documento,chave,item_numero,data_emissao,competencia,descricao,valor,origem,lc116,nbs,cst,normalizacao_status,normalizacao_pendencia,normalizacao_evidencia
    FROM movimentos WHERE empresa_id=? AND (COALESCE(lc116,'')<>'' OR COALESCE(nbs,'')<>'')
    ORDER BY valor DESC,id`).all(Number(empresaId));
  const itens = movimentos.map((movimento) => {
    const achado = avaliar(movimento);
    return achado && {
      movimento_id: movimento.id, empresa_id: movimento.empresa_id, tipo: movimento.tipo,
      contraparte: movimento.nome || 'Não identificada', cnpj_contraparte: movimento.inscr_federal || '',
      documento: movimento.documento || '', chave: movimento.chave || '', item_numero: movimento.item_numero || null,
      data_emissao: movimento.data_emissao || null, competencia: movimento.competencia || null,
      descricao: movimento.descricao || '', valor: r2(movimento.valor), origem: movimento.origem || '',
      lc116: bases.normLc116(movimento.lc116) || null, nbs: bases.normNbs(movimento.nbs) || null,
      normalizacao: { status: movimento.normalizacao_status || null, pendencia: movimento.normalizacao_pendencia || null, evidencia: movimento.normalizacao_evidencia || null },
      ...achado,
    };
  }).filter(Boolean);
  return {
    empresa_id: Number(empresaId),
    resumo: { total: itens.length, valor: r2(itens.reduce((s, x) => s + n(x.valor), 0)), por_tipo: itens.reduce((m, x) => ({ ...m, [x.tipo]: (m[x.tipo] || 0) + 1 }), {}) },
    itens,
  };
}

module.exports = { listar, avaliar };

/*
 * Diagnóstico preparatório para decisão fiscal reutilizável.
 * Leitura pura: não cria pendência, não classifica tributo e não altera fatos.
 */
const numero = (v) => Number(v || 0);

function auditar(db, empresaId) {
  const id = Number(empresaId);
  const empresa = db.prepare('SELECT id,razao_social,regime FROM empresas WHERE id=?').get(id);
  if (!empresa) throw new Error('Empresa não encontrada para auditoria de decisão fiscal.');

  // A consulta é agregada no SQLite. Assim a auditoria continua previsível
  // mesmo com carteiras grandes e não materializa todos os itens em memória.
  const base = `
    WITH ativos AS (
      SELECT m.*,
        NULLIF(TRIM(COALESCE(m.codigo_produto,'')), '') AS codigo_normalizado,
        NULLIF(TRIM(COALESCE(m.ncm,'')), '') AS ncm_normalizado,
        NULLIF(TRIM(COALESCE(m.descricao,'')), '') AS descricao_normalizada
      FROM movimentos m
      WHERE m.empresa_id=?
        AND COALESCE(m.situacao_documento,'AUTORIZADO') NOT IN ('CANCELADO','DENEGADO','INUTILIZADO')
    ), conflitos AS (
      SELECT codigo_normalizado
      FROM ativos
      WHERE codigo_normalizado IS NOT NULL
      GROUP BY codigo_normalizado
      HAVING COUNT(DISTINCT COALESCE(ncm_normalizado,'')) > 1
    ), avaliados AS (
      SELECT a.*,
        CASE
          WHEN a.produto_empresa_id IS NOT NULL THEN 'ELEGIVEL_IDENTIDADE_INTERNA'
          WHEN a.codigo_normalizado IN (SELECT codigo_normalizado FROM conflitos) THEN 'CONFLITO_DE_DADOS'
          WHEN a.codigo_normalizado IS NOT NULL THEN 'ELEGIVEL_CODIGO_EMPRESA'
          ELSE 'PENDENTE_IDENTIDADE'
        END AS situacao_identidade,
        CASE
          WHEN a.produto_empresa_id IS NOT NULL THEN 'PRODUTO_EMPRESA:' || a.produto_empresa_id
          WHEN a.codigo_normalizado IS NOT NULL THEN 'CODIGO_EMPRESA:' || a.codigo_normalizado
          ELSE NULL
        END AS identidade
      FROM ativos a
    )`;

  const resumo = db.prepare(`${base}
    SELECT COUNT(*) itens_analisaveis,
      COALESCE(SUM(valor),0) valor_analisavel,
      COUNT(DISTINCT documento || '|' || COALESCE(chave,'')) documentos_referenciados,
      COUNT(DISTINCT competencia) competencias
    FROM avaliados`).get(id);
  const porSituacao = db.prepare(`${base}
    SELECT situacao_identidade AS situacao, COUNT(*) quantidade, COALESCE(SUM(valor),0) valor
    FROM avaliados GROUP BY situacao_identidade ORDER BY quantidade DESC`).all(id);
  const decisoes = db.prepare(`${base}
    SELECT COUNT(DISTINCT identidade || '|' || COALESCE(sentido,'') || '|' || COALESCE(cfop,'') || '|' ||
      COALESCE(regime,'') || '|' || COALESCE(reducao,'') || '|' || COALESCE(cclasstrib,'') || '|' || COALESCE(modelo_documento_fiscal,'')) quantidade
    FROM avaliados
    WHERE situacao_identidade IN ('ELEGIVEL_IDENTIDADE_INTERNA','ELEGIVEL_CODIGO_EMPRESA')`).get(id);
  const consolidados = db.prepare(`${base}
    SELECT COUNT(DISTINCT COALESCE(competencia,'') || '|' || identidade || '|' || COALESCE(sentido,'') || '|' || COALESCE(cfop,'') || '|' ||
      COALESCE(regime,'') || '|' || COALESCE(reducao,'') || '|' || COALESCE(cclasstrib,'') || '|' || COALESCE(modelo_documento_fiscal,'')) quantidade
    FROM avaliados
    WHERE situacao_identidade IN ('ELEGIVEL_IDENTIDADE_INTERNA','ELEGIVEL_CODIGO_EMPRESA')`).get(id);
  const cancelados = db.prepare(`SELECT COUNT(*) quantidade, COALESCE(SUM(valor),0) valor
    FROM movimentos WHERE empresa_id=? AND COALESCE(situacao_documento,'AUTORIZADO') IN ('CANCELADO','DENEGADO','INUTILIZADO')`).get(id);

  const itens = numero(resumo.itens_analisaveis);
  const chaves = numero(decisoes.quantidade);
  const estados = Object.fromEntries(porSituacao.map((x) => [x.situacao, { quantidade:numero(x.quantidade), valor:numero(x.valor) }]));
  return {
    natureza:'AUDITORIA_SOMENTE_LEITURA',
    empresa:{ id:empresa.id, razao_social:empresa.razao_social, regime:empresa.regime },
    contrato:'DECISAO_FISCAL_REUTILIZAVEL_V1',
    resumo:{
      itens_analisaveis:itens, valor_analisavel:numero(resumo.valor_analisavel), documentos_referenciados:numero(resumo.documentos_referenciados),
      competencias:numero(resumo.competencias), itens_cancelados:numero(cancelados.quantidade), valor_cancelado:numero(cancelados.valor),
      decisoes_candidatas:chaves, consolidados_mensais_candidatos:numero(consolidados.quantidade),
      potencial_reuso_percentual:itens ? Math.round((1 - chaves / itens) * 10_000) / 100 : 0,
    },
    situacoes:estados,
    regra_de_seguranca:'Somente itens com identidade interna ou código estável da empresa, sem conflito de NCM, entram na estimativa. A auditoria não classifica tributos nem autoriza consolidação automática.',
  };
}

module.exports = { auditar };

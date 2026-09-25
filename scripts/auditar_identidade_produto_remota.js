#!/usr/bin/env node
/* Relatório somente leitura para validar identidade de produto antes de consolidar. */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path:path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const empresaId = Number(process.argv[2] || 38);
const destino = process.argv[3] || path.join(__dirname, '..', 'outputs', `auditoria-identidade-produto-empresa-${empresaId}.json`);

async function main() {
  if (!Number.isInteger(empresaId) || empresaId <= 0) throw new Error('Informe um id de empresa válido.');
  const client = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await client.connect();
  try {
    const empresa = await client.query('SELECT id,razao_social,regime FROM empresas WHERE id=$1', [empresaId]);
    if (!empresa.rows[0]) throw new Error('Empresa não encontrada.');
    const itens = await client.query(`
      WITH ativos AS (
        SELECT * FROM movimentos WHERE empresa_id=$1
          AND COALESCE(situacao_documento,'AUTORIZADO') NOT IN ('CANCELADO','DENEGADO','INUTILIZADO')
      ), codigos AS (
        SELECT NULLIF(TRIM(COALESCE(codigo_produto,'')), '') AS codigo_produto,
          COUNT(*)::int AS ocorrencias,
          COALESCE(SUM(valor),0)::text AS valor,
          COUNT(DISTINCT competencia)::int AS competencias,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(TRIM(COALESCE(ncm,'')), '')), NULL) AS ncms,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(TRIM(COALESCE(descricao,'')), '')), NULL) AS descricoes,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(REGEXP_REPLACE(LOWER(TRIM(COALESCE(descricao,''))), '[^[:alnum:]]+', '', 'g'), '')), NULL) AS descricoes_normalizadas
        FROM ativos
        WHERE NULLIF(TRIM(COALESCE(codigo_produto,'')), '') IS NOT NULL
        GROUP BY NULLIF(TRIM(COALESCE(codigo_produto,'')), '')
      )
      SELECT codigo_produto,ocorrencias,valor,competencias,ncms,descricoes,descricoes_normalizadas,
        CASE WHEN CARDINALITY(ncms)=1 THEN 'AGUARDANDO_IDENTIDADE_CANONICA'
          WHEN CARDINALITY(ncms)>1 THEN 'CONFLITO_NCM'
          ELSE 'PENDENTE_NCM_OU_IDENTIDADE' END AS situacao
      FROM codigos ORDER BY (COALESCE(valor,'0'))::numeric DESC, ocorrencias DESC, codigo_produto`, [empresaId]);
    for (const item of itens.rows) {
      if (item.situacao === 'AGUARDANDO_IDENTIDADE_CANONICA' && (item.descricoes_normalizadas || []).length > 1) item.situacao = 'REVISAR_DESCRICAO';
    }
    const semCodigo = await client.query(`SELECT COUNT(*)::int AS quantidade, COALESCE(SUM(valor),0)::text AS valor
      FROM movimentos WHERE empresa_id=$1
        AND COALESCE(situacao_documento,'AUTORIZADO') NOT IN ('CANCELADO','DENEGADO','INUTILIZADO')
        AND NULLIF(TRIM(COALESCE(codigo_produto,'')), '') IS NULL`, [empresaId]);
    const resumo = itens.rows.reduce((total, item) => {
      total[item.situacao] = (total[item.situacao] || 0) + 1;
      return total;
    }, {});
    const relatorio = {
      natureza:'AUDITORIA_SOMENTE_LEITURA', gerado_em:new Date().toISOString(),
      empresa:empresa.rows[0],
      criterio:'Código de produto é apenas evidência de origem. NCM e descrição consistentes servem para revisão humana, mas não criam identidade canônica nem classificação tributária.',
      resumo:{ codigos_analisados:itens.rows.length, por_situacao:resumo, itens_sem_codigo:Number(semCodigo.rows[0].quantidade), valor_itens_sem_codigo:semCodigo.rows[0].valor },
      codigos:itens.rows,
    };
    fs.mkdirSync(path.dirname(destino), { recursive:true });
    fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2));
    console.log(JSON.stringify({ natureza:relatorio.natureza, empresa:relatorio.empresa, resumo:relatorio.resumo, arquivo:path.resolve(destino) }, null, 2));
  } finally { await client.end(); }
}
main().catch((erro) => { console.error(erro.stack || erro.message); process.exitCode = 1; });

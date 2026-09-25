#!/usr/bin/env node
/* Medição somente leitura. Não executa motor, não grava no banco e não altera regra. */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path:path.join(__dirname, '..', '.env') });
const { Client } = require('pg');
const { resumo } = require('../src/services/assinaturaContextoFiscal');

const empresaId = Number(process.argv[2] || 38);
const destino = process.argv[3] || path.join(__dirname, '..', 'outputs', `auditoria-contextos-fiscais-empresa-${empresaId}.json`);

async function main() {
  if (!Number.isInteger(empresaId) || empresaId <= 0) throw new Error('Informe um id de empresa válido.');
  const client = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await client.connect();
  try {
    const empresa = await client.query('SELECT id,razao_social,regime FROM empresas WHERE id=$1', [empresaId]);
    if (!empresa.rows[0]) throw new Error('Empresa não encontrada.');
    const tabelas = await client.query(`SELECT to_regclass('public.revisoes_beneficios_itens') AS itens,
      to_regclass('public.revisoes_beneficios_fiscais') AS revisoes`);
    const revisoesDisponiveis = Boolean(tabelas.rows[0]?.itens && tabelas.rows[0]?.revisoes);
    const campoRevisao = revisoesDisponiveis
      ? `EXISTS(SELECT 1 FROM revisoes_beneficios_itens ri JOIN revisoes_beneficios_fiscais r ON r.id=ri.revisao_id
          WHERE ri.movimento_id=m.id AND r.empresa_id=m.empresa_id AND r.status='ATIVA')`
      : 'false';
    const itens = await client.query(`
      SELECT m.id,m.competencia,m.tipo,m.cfop,m.ncm,m.nbs,m.inscr_federal,m.valor,m.regime,
        COALESCE(to_jsonb(m)->>'sentido','') AS sentido,
        COALESCE(to_jsonb(m)->>'modelo_documento_fiscal','') AS modelo_documento_fiscal,
        COALESCE(to_jsonb(m)->>'lc116','') AS lc116,
        COALESCE(to_jsonb(m)->>'cst','') AS cst,
        COALESCE(to_jsonb(m)->>'csosn','') AS csosn,
        COALESCE(to_jsonb(m)->>'cst_pis','') AS cst_pis,
        COALESCE(to_jsonb(m)->>'cst_cofins','') AS cst_cofins,
        p.regime AS regime_cadastro,p.perfil_economico AS perfil_cadastro,
        CASE WHEN EXISTS(SELECT 1 FROM enriquecimento_pis_cofins_evidencias e
          WHERE e.empresa_id=m.empresa_id AND e.movimento_id=m.id AND e.origem_evidencia='SPED_C175') THEN 'SPED_C175' ELSE '' END AS origem_evidencia_pis_cofins,
        ${campoRevisao} AS tem_revisao_beneficio
      FROM movimentos m
      LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo AND p.cnpj=m.inscr_federal
      WHERE m.empresa_id=$1 AND COALESCE(m.situacao_documento,'AUTORIZADO') NOT IN ('CANCELADO','DENEGADO','INUTILIZADO')
      ORDER BY m.id`, [empresaId]);
    const medicao = resumo(itens.rows);
    const relatorio = {
      natureza:'AUDITORIA_SOMENTE_LEITURA', gerado_em:new Date().toISOString(), empresa:empresa.rows[0],
      criterio:'Assinatura conservadora do contexto que influencia classificação e seleção de regra. Não é identidade de produto, não agrupa documentos e não substitui cálculos monetários por item.',
      limite:'A estimativa cobre somente reuso de classificação e resolução de regra. Base econômica, valores, conferência documental, apuração e persistência continuam por movimento.',
      compatibilidade_esquema:{ revisoes_beneficios_disponiveis:revisoesDisponiveis },
      medicao:{ ...medicao, grupos:medicao.grupos.slice(0, 200) },
    };
    fs.mkdirSync(path.dirname(destino), { recursive:true });
    fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2));
    console.log(JSON.stringify({ natureza:relatorio.natureza, empresa:relatorio.empresa, medicao:{ itens:medicao.itens, contextos:medicao.contextos, chamadas_evitaveis:medicao.chamadas_evitaveis, reducao_percentual:medicao.reducao_percentual, grupos_reutilizaveis:medicao.grupos_reutilizaveis }, arquivo:path.resolve(destino) }, null, 2));
  } finally { await client.end(); }
}
main().catch((erro) => { console.error(erro.stack || erro.message); process.exitCode = 1; });

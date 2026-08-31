/* Validação read-only da migration Fase 4B e do baseline fiscal. */
require('dotenv').config();
const { Client } = require('pg');

if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

const tabelas = ['folhas_pagamento_competencias', 'margens_operacionais_premissas', 'receitas_sem_dfe'];
const colunasEsperadas = {
  folhas_pagamento_competencias: ['empresa_id', 'competencia', 'valor_folha', 'pro_labore', 'origem', 'referencia_arquivo', 'status_validacao'],
  margens_operacionais_premissas: ['empresa_id', 'periodo_inicio', 'periodo_fim', 'margem_operacional_percentual', 'origem', 'natureza', 'status_validacao'],
  receitas_sem_dfe: ['empresa_id', 'competencia', 'tipo_receita', 'descricao', 'valor', 'origem', 'evidencia', 'status_validacao', 'chave_deduplicacao'],
};

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const existentes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`, [tabelas]);
    const colunas = await client.query(`SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name = ANY($1)`, [tabelas]);
    const indices = await client.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename = ANY($1)`, [tabelas]);
    const baseline = await client.query(`SELECT count(*)::int AS resultados, coalesce(sum((dados->>'cbs')::numeric),0)::numeric AS cbs FROM motor_resultados_operacionais WHERE empresa_id=1 AND execucao_id=14 AND ativo=true`);
    const porTabela = Object.fromEntries(tabelas.map((tabela) => [tabela, {
      existe: existentes.rows.some((x) => x.table_name === tabela),
      colunas: colunas.rows.filter((x) => x.table_name === tabela).map((x) => ({ nome: x.column_name, anulavel: x.is_nullable === 'YES' })),
      faltantes: colunasEsperadas[tabela].filter((campo) => !colunas.rows.some((x) => x.table_name === tabela && x.column_name === campo)),
      indices: indices.rows.filter((x) => x.tablename === tabela).map((x) => x.indexname),
    }]));
    console.log(JSON.stringify({ tabelas: porTabela, baseline: baseline.rows[0] }, null, 2));
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

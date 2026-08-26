#!/usr/bin/env node
// Consulta somente leitura para confirmar o estado estrutural da Fase 1.
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const colunas = await client.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name='jobs_carteira'
      and column_name in ('proxima_tentativa_em','resultado','heartbeat','tentativas','max_tentativas','status','empresa_id','competencia','tipo_job') order by column_name`);
    const indice = await client.query(`select indexname from pg_indexes where schemaname='public'
      and tablename='jobs_carteira' and indexname='ux_jobs_carteira_ativo'`);
    const funcoes = await client.query(`select routine_name from information_schema.routines where routine_schema='public'
      and routine_name in ('claim_job_carteira','recuperar_jobs_carteira_abandonados') order by routine_name`);
    const colunasExecucao = await client.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name='motor_execucoes_operacionais' order by ordinal_position`);
    const execucoes = await client.query(`select id, empresa_id, dados->>'id' as execucao_id,
      dados->>'criado_em' as criado_em from public.motor_execucoes_operacionais
      where empresa_id=1 and id in (1,9,10) order by id`);
    const colunasResultado = await client.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name='motor_resultados_operacionais' order by ordinal_position`);
    const ativa = await client.query(`select execucao_id, count(*)::int as resultados
      from public.motor_resultados_operacionais where empresa_id=1 and ativo=true group by execucao_id order by execucao_id`);
    console.log(JSON.stringify({
      colunas: colunas.rows.map((x) => x.column_name),
      indice_ativo: indice.rows.map((x) => x.indexname),
      funcoes: funcoes.rows.map((x) => x.routine_name),
      colunas_execucao: colunasExecucao.rows.map((x) => x.column_name),
      execucoes: execucoes.rows,
      colunas_resultado: colunasResultado.rows.map((x) => x.column_name),
      fotografia_ativa: ativa.rows,
    }, null, 2));
  } finally { await client.end(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });

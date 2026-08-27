#!/usr/bin/env node
/* Audita e, com --aplicar, executa a migration aditiva da Fase 2A. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const tabelas = ['cadastro_parceiros_mestre','cadastro_produtos_mestre','cadastro_servicos_mestre','regras_enquadramento','hipoteses_credito_presumido','cobertura_fotografias'];
const migrations = [
  path.join(__dirname, '..', 'supabase', 'migrations', '20260826_fase2a_cobertura_enquadramento.sql'),
  path.join(__dirname, '..', 'supabase', 'migrations', '20260826_fase2a_parceiros_mestre.sql'),
];

async function inventario(client) {
  const cols = await client.query(`select table_name,column_name,data_type,is_nullable,column_default
      from information_schema.columns where table_schema='public' and table_name = any($1)
      order by table_name,ordinal_position`, [tabelas]);
  const inds = await client.query(`select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename = any($1) order by tablename,indexname`, [tabelas]);
  const rls = await client.query(`select c.relname as tabela,c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname = any($1) order by c.relname`, [tabelas]);
  const colunas = Object.fromEntries(tabelas.map((t) => [t, cols.rows.filter((x) => x.table_name === t)]));
  const indices = Object.fromEntries(tabelas.map((t) => [t, inds.rows.filter((x) => x.tablename === t)]));
  return { tabelas_existentes: tabelas.filter((t) => colunas[t].length), colunas, indices, rls: rls.rows };
}

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const antes = await inventario(client);
    let aplicada = false;
    if (process.argv.includes('--aplicar')) {
      await client.query('begin');
      try { for (const migration of migrations) await client.query(fs.readFileSync(migration, 'utf8')); await client.query('commit'); aplicada = true; }
      catch (erro) { await client.query('rollback'); throw erro; }
    }
    const depois = await inventario(client);
    const faltantes = tabelas.filter((t) => !depois.tabelas_existentes.includes(t));
    if (process.argv.includes('--aplicar') && faltantes.length) throw new Error(`Migração não homologada; tabelas ausentes: ${faltantes.join(', ')}`);
    console.log(JSON.stringify({ migrations: migrations.map((arquivo) => path.basename(arquivo)), aplicada, antes: { tabelas: antes.tabelas_existentes }, depois: { tabelas: depois.tabelas_existentes, rls: depois.rls, indices: Object.fromEntries(Object.entries(depois.indices).map(([k,v]) => [k,v.map((x) => x.indexname)])) }, faltantes }, null, 2));
  } finally { await client.end(); }
}
main().catch((erro) => { console.error(`Fase 2A / Supabase: ${erro.message}`); process.exit(1); });

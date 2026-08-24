/* Importa o catálogo completo para a fonte compartilhada sem depender do Excel em runtime. */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

const arquivo = process.argv[2];
if (!arquivo) throw new Error('Informe o arquivo XLSX do catálogo fiscal.');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-catalogo-'));
const bases = require('../src/services/basesReforma');
const db = require('../src/db');
const migracao = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260824_catalogo_pis_cofins.sql'), 'utf8');
const p = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function gravar(tabela) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all().map((x) => x.name);
  const linhas = db.prepare(`SELECT ${colunas.join(',')} FROM ${tabela}`).all();
  await p.query(`delete from public.${tabela}`);
  for (let i = 0; i < linhas.length; i += 250) {
    const lote = linhas.slice(i, i + 250);
    const valores = [], parametros = lote.map((linha, li) => `(${colunas.map((_, ci) => `$${li * colunas.length + ci + 1}`).join(',')})`).join(',');
    lote.forEach((linha) => colunas.forEach((c) => valores.push(linha[c] ?? null)));
    await p.query(`insert into public.${tabela} (${colunas.join(',')}) values ${parametros}`, valores);
  }
  return linhas.length;
}

(async () => {
  const resultado = bases.importarCatalogoFiscal(fs.readFileSync(arquivo), { arquivo: path.basename(arquivo) });
  await p.query(migracao);
  await p.query('begin');
  try {
    const produtos = await gravar('base_ncm');
    const servicos = await gravar('base_servicos');
    await p.query('commit');
    console.log(JSON.stringify({ importacao: resultado.importados, produtos, servicos }));
  } catch (e) { await p.query('rollback'); throw e; }
  await p.end();
})().catch(async (e) => { console.error(e.message); await p.end(); process.exitCode = 1; });

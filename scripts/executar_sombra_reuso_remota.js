#!/usr/bin/env node
/*
 * Lê somente empresa, parceiros e movimentos da fonte compartilhada, injeta-os
 * numa cópia temporária da base local e delega a comparação em sombra. Nenhuma
 * escrita é feita no Supabase ou na base local de origem.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path:path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const empresaRemotaId = Number(process.argv[2] || 38);
const limite = Math.max(1, Number(process.argv[3] || 20000));
const raiz = path.join(__dirname, '..');
const baseOrigem = path.join(raiz, 'dados', 'reforma.db');
const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-sombra-remota-'));
const destino = path.join(raiz, 'outputs', `sombra-reuso-classificacao-remota-empresa-${empresaRemotaId}.json`);

function inserir(db, tabela, dados, substituicoes = {}) {
  const colunas = new Set(db.prepare(`PRAGMA table_info(${tabela})`).all().map((x) => x.name));
  const linha = { ...dados, ...substituicoes };
  delete linha.id;
  const chaves = Object.keys(linha).filter((chave) => colunas.has(chave) && linha[chave] !== undefined && chave !== 'lote_id');
  const valores = chaves.map((chave) => typeof linha[chave] === 'object' && linha[chave] !== null ? JSON.stringify(linha[chave]) : linha[chave]);
  if (!chaves.length) throw new Error(`Nenhuma coluna compatível para ${tabela}.`);
  const sql = `INSERT INTO ${tabela} (${chaves.join(',')}) VALUES (${chaves.map(() => '?').join(',')})`;
  return db.prepare(sql).run(...valores);
}

async function main() {
  if (!Number.isInteger(empresaRemotaId) || empresaRemotaId <= 0) throw new Error('Informe um id de empresa válido.');
  if (!fs.existsSync(baseOrigem)) throw new Error(`Base local não encontrada: ${baseOrigem}`);
  fs.copyFileSync(baseOrigem, path.join(temporario, 'reforma.db'));
  console.log('[sombra remota] preparando cópia temporária');
  const client = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await client.connect();
  let empresa, parceiros, movimentos;
  try {
    const empresaConsulta = await client.query('SELECT to_jsonb(e) AS dados FROM empresas e WHERE id=$1', [empresaRemotaId]);
    empresa = empresaConsulta.rows[0]?.dados;
    if (!empresa) throw new Error('Empresa não encontrada na fonte compartilhada.');
    parceiros = (await client.query('SELECT to_jsonb(p) AS dados FROM parceiros p WHERE empresa_id=$1', [empresaRemotaId])).rows.map((x) => x.dados);
    movimentos = (await client.query(`SELECT to_jsonb(m) AS dados FROM movimentos m WHERE empresa_id=$1
      AND COALESCE(m.situacao_documento,'AUTORIZADO') NOT IN ('CANCELADO','DENEGADO','INUTILIZADO') ORDER BY id LIMIT $2`, [empresaRemotaId, limite])).rows.map((x) => x.dados);
  } finally { await client.end(); }
  console.log(`[sombra remota] leitura concluída: ${movimentos.length} movimentos e ${parceiros.length} parceiros`);
  process.env.SATTVA_DADOS = temporario;
  let db;
  try {
    db = require('../src/db');
    const existente = db.prepare('SELECT id FROM empresas WHERE cnpj=?').get(empresa.cnpj);
    if (existente) throw new Error('A cópia local já contém o mesmo CNPJ; a sombra remota foi interrompida para não misturar empresas.');
    const empresaLocalId = Number(inserir(db, 'empresas', empresa).lastInsertRowid);
    db.transaction(() => {
      for (const parceiro of parceiros) inserir(db, 'parceiros', parceiro, { empresa_id:empresaLocalId });
      for (const movimento of movimentos) inserir(db, 'movimentos', movimento, { empresa_id:empresaLocalId, lote_id:null });
    })();
    console.log('[sombra remota] cópia temporária populada; iniciando comparação');
    db.close();
    const execucao = spawnSync(process.execPath, [path.join(__dirname, 'executar_sombra_reuso_classificacao.js'), String(empresaLocalId), String(limite)], {
      env:{ ...process.env, SATTVA_SOMBRA_DIRETORIO:temporario, SATTVA_SOMBRA_DESTINO:destino }, encoding:'utf8',
    });
    process.stdout.write(execucao.stdout || '');
    process.stderr.write(execucao.stderr || '');
    if (execucao.status !== 0) process.exitCode = execucao.status || 1;
  } finally {
    try { db?.close(); } catch (_) { /* encerramento */ }
    fs.rmSync(temporario, { recursive:true, force:true });
  }
}
main().catch((erro) => { console.error(erro.stack || erro.message); process.exitCode = 1; });

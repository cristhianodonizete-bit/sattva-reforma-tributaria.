/* Carga resumível da base RFB local para o PostgreSQL do Supabase. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const copyFrom = require('pg-copy-streams').from;
const db = require('../src/db');

const URL = process.env.SUPABASE_DB_URL;
if (!URL) throw new Error('SUPABASE_DB_URL não configurada no .env');

const checkpoint = path.join(__dirname, '..', 'dados', 'rfb_migracao_checkpoint.json');
const BATCH = Number(process.env.RFB_BATCH_SIZE || 10000);
const pool = new Pool({ connectionString: URL, ssl: { rejectUnauthorized: false } });

function csv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function salvar(ultimo, enviados) {
  fs.writeFileSync(checkpoint, JSON.stringify({ ultimo_rowid: ultimo, enviados, atualizado_em: new Date().toISOString() }));
}
function estado() {
  try { return JSON.parse(fs.readFileSync(checkpoint, 'utf8')); } catch (_) { return { ultimo_rowid: 0, enviados: 0 }; }
}
async function copiar(client, linhas) {
  const stream = client.query(copyFrom('COPY public.base_regime (cnpj, raiz, regime, ano, fonte) FROM STDIN WITH (FORMAT csv)'));
  return new Promise((resolve, reject) => {
    stream.on('error', reject).on('finish', resolve);
    for (const x of linhas) stream.write([x.cnpj, x.raiz, x.regime, x.ano, x.fonte].map(csv).join(',') + '\n');
    stream.end();
  });
}
async function main() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM base_regime').get().c;
  const remote = await pool.query('SELECT COUNT(*)::int AS c FROM public.base_regime');
  let { ultimo_rowid: ultimo, enviados } = estado();
  console.log(JSON.stringify({ total_local: total, remoto_antes: remote.rows[0].c, retomando_do_rowid: ultimo, enviados }));
  const buscar = db.prepare('SELECT rowid, cnpj, raiz, regime, ano, fonte FROM base_regime WHERE rowid > ? ORDER BY rowid LIMIT ?');
  const client = await pool.connect();
  try {
    for (;;) {
      const linhas = buscar.all(ultimo, BATCH);
      if (!linhas.length) break;
      await copiar(client, linhas);
      ultimo = linhas[linhas.length - 1].rowid;
      enviados += linhas.length;
      salvar(ultimo, enviados);
      console.log(JSON.stringify({ enviados, total, percentual: Number((enviados / total * 100).toFixed(2)), ultimo_rowid: ultimo }));
    }
  } finally { client.release(); await pool.end(); }
  const final = await new Pool({ connectionString: URL, ssl: { rejectUnauthorized: false } }).query('SELECT COUNT(*)::int AS c FROM public.base_regime');
  console.log(JSON.stringify({ concluido: true, remoto_depois: final.rows[0].c }));
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });

require('dotenv').config();
const fs = require('fs'), path = require('path'), { Client } = require('pg');
const { especificacao } = require('../src/services/tratamentoPisCofins');
const out = path.resolve(__dirname, '../outputs');
const regras = JSON.parse(fs.readFileSync(path.join(out, 'pacote_regras_publicaveis_pis_cofins.json')));
const bloqueadas = JSON.parse(fs.readFileSync(path.join(out, 'pacote_regras_nao_publicaveis_pis_cofins.json')));
const ids = new Set(regras.map((r) => r.id));
if (ids.size !== 364 || bloqueadas.length !== 6 || bloqueadas.some((r) => ids.has(r.id))
  || regras.some((r) => r.status_publicacao !== 'RASCUNHO_VALIDO' || (r.nbs && !r.lc116))) throw Error('Pacote inválido; carga abortada.');
const escrever = process.argv.includes('--write');
const linhas = regras.map((r) => ({ ...especificacao(r.tratamento), ...r,
  familia: r.familia_juridica_id, condicoes_obrigatorias: r.condicoes_obrigatorias || [] }));

(async () => {
  if (!escrever) return console.log(JSON.stringify({ modo: 'DRY_RUN', regras_publicaveis: regras.length, regras_obsoletas: bloqueadas.length, escrita_realizada: false }, null, 2));
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  try {
    await c.query("BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '20s'");
    const q = await c.query(`INSERT INTO public.regras_enquadramento
      (id,familia,ncm,nbs,lc116,condicoes_obrigatorias,tratamento_resultante,fundamento_legal,status,prioridade,cst_pis,cst_cofins,pis_percentual,cofins_percentual,regime_pis_cofins)
      SELECT id,familia,ncm,nbs,lc116,condicoes_obrigatorias,tratamento,fundamento,'RASCUNHO',100,cst_pis,cst_cofins,pis_percentual,cofins_percentual,regime_pis_cofins
      FROM jsonb_to_recordset($1::jsonb) AS x(id text,familia text,ncm text,nbs text,lc116 text,condicoes_obrigatorias jsonb,tratamento text,fundamento text,cst_pis text,cst_cofins text,pis_percentual numeric,cofins_percentual numeric,regime_pis_cofins text)
      ON CONFLICT (id) DO UPDATE SET familia=excluded.familia,ncm=excluded.ncm,nbs=excluded.nbs,lc116=excluded.lc116,condicoes_obrigatorias=excluded.condicoes_obrigatorias,tratamento_resultante=excluded.tratamento_resultante,fundamento_legal=excluded.fundamento_legal,cst_pis=excluded.cst_pis,cst_cofins=excluded.cst_cofins,pis_percentual=excluded.pis_percentual,cofins_percentual=excluded.cofins_percentual,regime_pis_cofins=excluded.regime_pis_cofins
      WHERE public.regras_enquadramento.status='RASCUNHO' RETURNING id`, [JSON.stringify(linhas)]);
    if (q.rowCount !== regras.length) throw new Error(`Hidratação incompleta: ${q.rowCount}/${regras.length}.`);
    await c.query('COMMIT');
    console.log(JSON.stringify({ modo: 'CARGA_SEGURA_RASCUNHO', regras_publicaveis: regras.length, hidratadas: q.rowCount, obsoletas: 0, escrita_realizada: true }, null, 2));
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { await c.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });

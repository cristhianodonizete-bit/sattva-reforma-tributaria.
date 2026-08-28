require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const destino = process.argv[2];
if (!destino) throw new Error('Informe o arquivo de saída da fotografia.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const hash = (valor) => crypto.createHash('sha256').update(JSON.stringify(valor)).digest('hex');

(async () => {
  const { rows } = await pool.query(`
    select empresa_id, movimento_id, execucao_id, ativo,
           dados ->> 'cbs' as cbs,
           dados ->> 'ibs' as ibs,
           coalesce(dados ->> 'natureza', dados ->> 'natureza_resultado') as natureza,
           coalesce(dados ->> 'cclasstrib', dados ->> 'cClassTrib') as cclasstrib,
           coalesce(dados ->> 'cst', dados ->> 'cst_ibs_cbs') as cst,
           dados
      from public.motor_resultados_operacionais
     order by empresa_id, movimento_id, execucao_id, id
  `);
  const resumo = {
    gerado_em: new Date().toISOString(),
    total_resultados: rows.length,
    soma_cbs: rows.reduce((s, r) => s + Number(r.cbs || 0), 0),
    soma_ibs: rows.reduce((s, r) => s + Number(r.ibs || 0), 0),
    natureza_por_valor: {},
    classificacao_por_valor: {},
    assinatura_linhas: hash(rows.map((r) => ({
      empresa_id: r.empresa_id, movimento_id: r.movimento_id,
      execucao_id: r.execucao_id, ativo: r.ativo,
      cbs: r.cbs, ibs: r.ibs, natureza: r.natureza,
      cclasstrib: r.cclasstrib, cst: r.cst, dados: r.dados,
    }))),
  };
  for (const r of rows) {
    const natureza = r.natureza || 'SEM_VALOR';
    const classificacao = `${r.cst || 'SEM_CST'}|${r.cclasstrib || 'SEM_CCLASSTRIB'}`;
    resumo.natureza_por_valor[natureza] = (resumo.natureza_por_valor[natureza] || 0) + 1;
    resumo.classificacao_por_valor[classificacao] = (resumo.classificacao_por_valor[classificacao] || 0) + 1;
  }
  fs.writeFileSync(destino, `${JSON.stringify(resumo, null, 2)}\n`);
  console.log(JSON.stringify(resumo, null, 2));
  await pool.end();
})().catch(async (erro) => { console.error(erro.stack || erro.message); await pool.end(); process.exit(1); });

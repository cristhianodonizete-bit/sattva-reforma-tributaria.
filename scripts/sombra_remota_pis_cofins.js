require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { Client } = require('pg');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-sombra-remota-'));
const db = require('../src/db');
const motor = require('../src/services/motorCondicionalPisCofins');
const destino = path.resolve(__dirname, '../outputs/shadow_producao_pis_cofins_resultado.json');

function lc116(v) { return String(v || '').replace(/\D/g, '').padStart(4, '0').slice(0, 4); }
(async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  try {
    const [regras, movimentos] = await Promise.all([
      c.query("SELECT * FROM public.regras_enquadramento WHERE id LIKE 'RASCUNHO_FINAL_%'"),
      c.query('SELECT id,empresa_id,ncm,nbs,lc116,cfop,regime,codigo_produto,data_emissao,competencia FROM public.movimentos ORDER BY id'),
    ]);
    const inserir = db.prepare('INSERT INTO regras_enquadramento(id,familia,ncm,nbs,lc116,condicoes_obrigatorias,tratamento_resultante,status,prioridade,cst_pis,cst_cofins,pis_percentual,cofins_percentual) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    db.transaction(() => regras.rows.forEach((r) => inserir.run(r.id, r.familia, r.ncm, r.nbs, r.lc116,
      JSON.stringify(r.condicoes_obrigatorias || []), r.tratamento_resultante, 'ATIVA', r.prioridade,
      r.cst_pis, r.cst_cofins, r.pis_percentual, r.cofins_percentual)))();
    const resumo = { operacoes: movimentos.rowCount, sem_alteracao: 0, alteracoes_esperadas: 0,
      indeterminadas_esperadas: 0, indeterminadas_indevidas: 0, erros: 0, por_tipo: {} };
    for (const m of movimentos.rows) {
      try {
        const r = motor.resolverTratamentoAtivo({ ...m, lc116: lc116(m.lc116) }, { regime: m.regime });
        if (r.status === 'APLICAVEL') resumo.alteracoes_esperadas++;
        else if (r.status === 'INDETERMINADA') resumo.indeterminadas_esperadas++;
        else resumo.sem_alteracao++;
        const tipo = m.ncm ? 'NCM' : m.nbs ? 'NBS_LC116' : 'SEM_CHAVE'; resumo.por_tipo[tipo] = (resumo.por_tipo[tipo] || 0) + 1;
      } catch (e) { resumo.erros++; }
    }
    const saida = { executado_em: new Date().toISOString(), modo: 'SOMBRA_TEMPORARIA_SEM_ESCRITA_PRODUTIVA',
      regras_remotas: regras.rowCount, ...resumo, shadow_aprovado: resumo.erros === 0 && resumo.indeterminadas_indevidas === 0 };
    fs.writeFileSync(destino, JSON.stringify(saida, null, 2)); console.log(JSON.stringify(saida, null, 2));
  } finally { await c.end(); db.close(); fs.rmSync(process.env.SATTVA_DADOS, { recursive: true, force: true }); }
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });

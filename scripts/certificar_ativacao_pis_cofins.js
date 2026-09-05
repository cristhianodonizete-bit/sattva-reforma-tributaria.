require('dotenv').config();
const fs = require('fs'), path = require('path'), os = require('os');
const { Client } = require('pg');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-cert-pis-'));
const { FATOS } = require('../src/services/cadastroFiscalComplementar');
const { especificacao } = require('../src/services/tratamentoPisCofins');

const regras = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../outputs/pacote_regras_publicaveis_pis_cofins.json')));
const ids = regras.map((r) => r.id);
const fatosEsperados = new Set([...regras.flatMap((r) => (r.condicoes_obrigatorias || []).map((c) => c.fato)), 'receita_telecomunicacoes']);
const escrever = process.argv.includes('--activate');

function igualdade(a, b) { return String(a ?? '') === String(b ?? ''); }
(async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  try {
    const lote = await c.query(`SELECT * FROM public.regras_enquadramento WHERE id = ANY($1::text[]) ORDER BY id`, [ids]);
    const remoto = new Map(lote.rows.map((r) => [r.id, r]));
    const divergencias = regras.filter((r) => {
      const x = remoto.get(r.id); if (!x) return true; const t = especificacao(r.tratamento);
      return !igualdade(x.familia, r.familia_juridica_id) || !igualdade(x.ncm, r.ncm) || !igualdade(x.nbs, r.nbs)
        || !igualdade(x.lc116, r.lc116) || !igualdade(x.tratamento_resultante, r.tratamento)
        || !igualdade(x.cst_pis, t.cst_pis) || !igualdade(x.cst_cofins, t.cst_cofins)
        || Number(x.pis_percentual) !== t.pis_percentual || Number(x.cofins_percentual) !== t.cofins_percentual;
    }).map((r) => r.id);
    const exemplo = regras[0], remotoExemplo = remoto.get(exemplo.id), esperadoExemplo = especificacao(exemplo.tratamento);
    const desconhecidos = [...fatosEsperados].filter((f) => !FATOS[f]);
    const obsoletos = await c.query("SELECT count(*)::int c FROM public.regras_enquadramento WHERE id LIKE 'RASCUNHO_FINAL_%' AND id <> ALL($1::text[])", [ids]);
    const porStatus = await c.query("SELECT status,count(*)::int quantidade FROM public.regras_enquadramento WHERE id = ANY($1::text[]) GROUP BY status ORDER BY status", [ids]);
    const pronto = lote.rowCount === 364 && divergencias.length === 0 && desconhecidos.length === 0 && Number(obsoletos.rows[0].c) === 0;
    if (escrever) {
      if (!pronto) throw new Error('GATE_ATIVACAO_REPROVADO');
      const jaAtivas = porStatus.rows.length === 1 && porStatus.rows[0].status === 'ATIVA' && Number(porStatus.rows[0].quantidade) === 364;
      if (!jaAtivas) {
        await c.query('BEGIN');
        const ativadas = await c.query("UPDATE public.regras_enquadramento SET status='ATIVA' WHERE id = ANY($1::text[]) AND status='RASCUNHO' RETURNING id", [ids]);
        if (ativadas.rowCount !== 364) { await c.query('ROLLBACK'); throw new Error(`ATIVACAO_INCOMPLETA:${ativadas.rowCount}`); }
        await c.query('COMMIT');
      }
    }
    const apos = await c.query("SELECT status,count(*)::int quantidade FROM public.regras_enquadramento WHERE id = ANY($1::text[]) GROUP BY status ORDER BY status", [ids]);
    const saida = { executado_em: new Date().toISOString(), regras_carregadas: lote.rowCount, divergencias_arquivo_banco: divergencias.length,
      exemplos_divergencias: divergencias.slice(0, 5),
      exemplo_comparacao: { esperado: { familia: exemplo.familia_juridica_id, ncm: exemplo.ncm, nbs: exemplo.nbs, lc116: exemplo.lc116, tratamento: exemplo.tratamento, cst_pis: esperadoExemplo.cst_pis, cst_cofins: esperadoExemplo.cst_cofins, pis: esperadoExemplo.pis_percentual, cofins: esperadoExemplo.cofins_percentual }, remoto: remotoExemplo && { familia: remotoExemplo.familia, ncm: remotoExemplo.ncm, nbs: remotoExemplo.nbs, lc116: remotoExemplo.lc116, tratamento: remotoExemplo.tratamento_resultante, cst_pis: remotoExemplo.cst_pis, cst_cofins: remotoExemplo.cst_cofins, pis: remotoExemplo.pis_percentual, cofins: remotoExemplo.cofins_percentual } },
      fatos_esperados: fatosEsperados.size, fatos_reconhecidos: fatosEsperados.size - desconhecidos.length,
      fatos_orfaos: desconhecidos, regras_obsoletas_carregadas: Number(obsoletos.rows[0].c),
      status_antes: porStatus.rows, ativacao_solicitada: escrever, status_depois: apos.rows,
      gate_ativacao: pronto ? 'APROVADO' : 'REPROVADO' };
    const pasta = path.resolve(__dirname, '../outputs');
    fs.writeFileSync(path.join(pasta, 'certificacao_producao_pis_cofins.json'), JSON.stringify(saida, null, 2));
    if (escrever) fs.writeFileSync(path.join(pasta, 'ativacao_producao_pis_cofins.json'), JSON.stringify(saida, null, 2));
    console.log(JSON.stringify(saida, null, 2));
  } finally { await c.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });

/*
 * Diagnóstico somente leitura do cadastro canônico de parceiros.
 * Uso: node scripts/auditar_duplicidades_parceiros_canonicos.js [CNPJ]
 * Não remove, atualiza, publica nem sincroniza qualquer registro.
 */
require('dotenv').config();
const { Client } = require('pg');

const digitos = (v) => String(v || '').replace(/\D/g, '');
const texto = (v) => String(v || '').trim().replace(/\s+/g, ' ');
const chave = (linha) => {
  const cnpj = digitos(linha.cnpj);
  if (cnpj) return `CNPJ|${String(linha.tipo || '').toLowerCase()}|${cnpj}`;
  return `GENERICO|${String(linha.tipo || '').toLowerCase()}|${String(linha.origem || '').toUpperCase()}|${String(linha.regime || '').toLowerCase()}|${texto(linha.descricao).toUpperCase()}`;
};
const conteudo = (linha) => JSON.stringify({
  tipo:String(linha.tipo || '').toLowerCase(), cnpj:digitos(linha.cnpj),
  descricao:texto(linha.descricao).toUpperCase(), regime:String(linha.regime || '').toLowerCase(),
});

async function main() {
  const cnpj = digitos(process.argv[2]);
  if (cnpj && cnpj.length !== 14) throw new Error('Informe o CNPJ da empresa com 14 dígitos ou omita para consolidado geral.');
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
  const db = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const empresa = cnpj ? await db.query("SELECT id,cnpj,razao_social FROM public.empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1 LIMIT 2", [cnpj]) : null;
    if (empresa && empresa.rows.length !== 1) throw new Error('Empresa canônica não identificada de forma única.');
    const linhas = await db.query(`SELECT p.id,p.empresa_id,p.tipo,p.cnpj,p.descricao,p.regime,p.origem,p.criado_em,e.razao_social
      FROM public.parceiros p JOIN public.empresas e ON e.id=p.empresa_id WHERE COALESCE(p.ativo,true) IS TRUE${empresa ? ' AND p.empresa_id=$1' : ''}
      ORDER BY p.empresa_id,p.criado_em DESC NULLS LAST,p.id DESC`, empresa ? [empresa.rows[0].id] : []);
    await db.query('ROLLBACK');
    const grupos = new Map();
    for (const linha of linhas.rows) {
      const identidade=`${linha.empresa_id}|${chave(linha)}`;
      const grupo = grupos.get(identidade) || [];
      grupo.push(linha); grupos.set(identidade, grupo);
    }
    const duplicados = [...grupos.entries()].filter(([, grupo]) => grupo.length > 1).map(([identidade, grupo]) => ({
      identidade, quantidade:grupo.length, excesso:grupo.length - 1,
      conteudo_uniforme:new Set(grupo.map(conteudo)).size === 1,
      manter:{ id:grupo[0].id, cnpj:grupo[0].cnpj || null, descricao:grupo[0].descricao, regime:grupo[0].regime, origem:grupo[0].origem },
      revisar:new Set(grupo.map(conteudo)).size !== 1,
    }));
    const resumo = {
      somente_leitura:true,
      empresa:empresa ? empresa.rows[0] : 'TODAS_AS_EMPRESAS',
      registros_fisicos:linhas.rows.length,
      fornecedores_logicos:grupos.size,
      grupos_duplicados:duplicados.length,
      copias_tecnicas_candidatas:duplicados.filter((x) => x.conteudo_uniforme).reduce((s, x) => s + x.excesso, 0),
      grupos_com_revisao_humana:duplicados.filter((x) => x.revisar).length,
      excesso_em_revisao:duplicados.filter((x) => x.revisar).reduce((s, x) => s + x.excesso, 0),
      amostra:duplicados.slice(0, 30),
    };
    console.log(JSON.stringify(resumo, null, 2));
  } finally {
    try { await db.query('ROLLBACK'); } catch (_) { /* já encerrada */ }
    await db.end();
  }
}

main().catch((erro) => { console.error(erro.message); process.exitCode = 1; });

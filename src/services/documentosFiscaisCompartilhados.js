// Leitura direta e estritamente somente-leitura da fonte operacional.
// Não conhece SQLite, motor, filas ou publicação: a tela pode compará-la sem
// alterar qualquer fotografia fiscal local.
const { Client } = require('pg');

function limite(v) { return Math.min(Math.max(Number(v) || 100, 1), 100); }
function pagina(v) { return Math.max(Number(v) || 1, 1); }

function filtrosSql(f = {}, parametros) {
  const partes = [];
  if (f.competencia) { parametros.push(String(f.competencia)); partes.push(`competencia=$${parametros.length}`); }
  if (f.sentido) { parametros.push(String(f.sentido)); partes.push(`tipo=$${parametros.length}`); }
  if (f.modelo) { parametros.push(String(f.modelo).toUpperCase()); partes.push(`UPPER(COALESCE(NULLIF(modelo_documento_fiscal,''),'NAO_IDENTIFICADO'))=$${parametros.length}`); }
  if (f.busca) { parametros.push(`%${String(f.busca).trim().toLowerCase()}%`); partes.push(`LOWER(COALESCE(documento,chave,'') || ' ' || COALESCE(chave,'') || ' ' || COALESCE(parceiro,'')) LIKE $${parametros.length}`); }
  return partes.length ? `WHERE ${partes.join(' AND ')}` : '';
}

async function listar(cnpj, filtros = {}, opcoes = {}) {
  if (!process.env.SUPABASE_DB_URL) throw new Error('Fonte compartilhada indisponível para a leitura direta de documentos.');
  const l = limite(opcoes.limite), p = pagina(opcoes.pagina), offset = (p - 1) * l;
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized:false } });
  await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const empresa = await db.query("SELECT id FROM public.empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1 LIMIT 2", [String(cnpj).replace(/\D/g,'')]);
    if (empresa.rows.length !== 1) throw new Error('Empresa compartilhada não identificada unicamente para leitura documental.');
    const params = [empresa.rows[0].id];
    // Competência, quando informada, entra aqui, antes da deduplicação. A
    // invariável foi validada globalmente em auditoria read-only.
    const ondeItens = filtros.competencia ? ` AND m.competencia=$2` : '';
    if (filtros.competencia) params.push(String(filtros.competencia));
    const base = `WITH canonicos AS (
      SELECT m.*,ROW_NUMBER() OVER (PARTITION BY CASE WHEN NULLIF(m.chave,'') IS NOT NULL THEN 'xml:'||m.chave||':'||COALESCE(m.item_numero::text,'__SEM_ITEM__') ELSE 'id:'||m.id::text END ORDER BY m.id DESC) linha
      FROM public.movimentos m WHERE m.empresa_id=$1${ondeItens}
    ), docs AS (
      SELECT CASE WHEN NULLIF(chave,'') IS NOT NULL THEN 'chave:'||chave ELSE 'movimento:'||id::text END referencia,
       COALESCE(NULLIF(MAX(documento),''),NULLIF(MAX(chave),''),'Lançamento #'||MIN(id)::text) documento,
       MIN(competencia) competencia,MIN(data_emissao) data_emissao,MAX(chave) chave,MAX(tipo) tipo,MAX(origem) origem,MAX(cfop) cfop,MAX(modelo_documento_fiscal) modelo_documento_fiscal,MAX(nome) parceiro,MIN(id) item_id,COUNT(*)::int itens,SUM(COALESCE(valor,0)) valor,MAX(criado_em) criado_em
      FROM canonicos WHERE linha=1 GROUP BY CASE WHEN NULLIF(chave,'') IS NOT NULL THEN 'chave:'||chave ELSE 'movimento:'||id::text END
    ) SELECT * FROM docs`;
    const filtro = filtrosSql({ ...filtros, competencia: null }, params);
    const count = await db.query(`SELECT COUNT(*)::int total FROM (${base}) d ${filtro}`, params);
    params.push(l, offset);
    const dados = await db.query(`${base} ${filtro} ORDER BY COALESCE(data_emissao::text,competencia,criado_em::text) DESC,item_id DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
    await db.query('ROLLBACK');
    return { fonte:'SUPABASE_COMPARTILHADO_SOMBRA', documentos:dados.rows, total:count.rows[0].total, paginacao:{pagina:p,limite:l,totalPaginas:Math.max(1,Math.ceil(count.rows[0].total/l))} };
  } catch (e) { try { await db.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { await db.end(); }
}
module.exports = { listar };

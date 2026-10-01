// Leitura direta e estritamente somente-leitura da fonte operacional.
// Não conhece SQLite, motor, filas ou publicação: a tela pode compará-la sem
// alterar qualquer fotografia fiscal local.
const { Pool } = require('pg');

// A leitura direta é uma rota de tela. Reabrir uma conexão TLS a cada filtro
// era o custo dominante da validação, não a consulta. O pool é pequeno,
// exclusivo deste leitor e cada uso continua delimitado por READ ONLY +
// ROLLBACK; ele nunca retém dados de empresa em memória.
let pool = null;
function obterPool() {
  if (!pool) {
    pool = new Pool({
      connectionString:process.env.SUPABASE_DB_URL,
      ssl:{ rejectUnauthorized:false },
      max:4,
      idleTimeoutMillis:30000,
      connectionTimeoutMillis:10000,
    });
  }
  return pool;
}

function limite(v) { return Math.min(Math.max(Number(v) || 100, 1), 100); }
function pagina(v) { return Math.max(Number(v) || 1, 1); }
function limiteExportacao() { return Math.min(Math.max(Number(process.env.LIMITE_EXPORTACAO_DOCUMENTOS_DIRETA) || 10000, 1), 50000); }

function filtrosSql(f = {}, parametros) {
  const partes = [];
  if (f.competencia) { parametros.push(String(f.competencia)); partes.push(`competencia=$${parametros.length}`); }
  if (f.sentido) { parametros.push(String(f.sentido)); partes.push(`tipo=$${parametros.length}`); }
  if (f.modelo) { parametros.push(String(f.modelo).toUpperCase()); partes.push(`UPPER(COALESCE(NULLIF(modelo_documento_fiscal,''),'NAO_IDENTIFICADO'))=$${parametros.length}`); }
  const minimo=f.valor_minimo === undefined || f.valor_minimo === '' ? null : Number(String(f.valor_minimo).replace(',','.'));
  const maximo=f.valor_maximo === undefined || f.valor_maximo === '' ? null : Number(String(f.valor_maximo).replace(',','.'));
  if (Number.isFinite(minimo)) { parametros.push(minimo); partes.push(`valor >= $${parametros.length}`); }
  if (Number.isFinite(maximo)) { parametros.push(maximo); partes.push(`valor <= $${parametros.length}`); }
  if (f.busca) { parametros.push(`%${String(f.busca).trim().toLowerCase()}%`); partes.push(`LOWER(COALESCE(documento,chave,'') || ' ' || COALESCE(chave,'') || ' ' || COALESCE(parceiro,'')) LIKE $${parametros.length}`); }
  return partes.length ? `WHERE ${partes.join(' AND ')}` : '';
}

async function listar(cnpj, filtros = {}, opcoes = {}) {
  if (!process.env.SUPABASE_DB_URL) throw new Error('Fonte compartilhada indisponível para a leitura direta de documentos.');
  const inicio=process.hrtime.bigint();
  const exportacao=opcoes.exportacao === true;
  const l = exportacao ? limiteExportacao() : limite(opcoes.limite), p = exportacao ? 1 : pagina(opcoes.pagina), offset = (p - 1) * l;
  const db = await obterPool().connect();
  try {
    await db.query('BEGIN READ ONLY');
    const empresa = await db.query("SELECT id FROM public.empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1 LIMIT 2", [String(cnpj).replace(/\D/g,'')]);
    if (empresa.rows.length !== 1) throw new Error('Empresa compartilhada não identificada unicamente para leitura documental.');
    const params = [empresa.rows[0].id];
    // Competência, quando informada, entra aqui, antes da deduplicação. A
    // invariável foi validada globalmente em auditoria read-only.
    const condicoesItens=[];
    if (filtros.competencia) { params.push(String(filtros.competencia)); condicoesItens.push(`m.competencia=$${params.length}`); }
    // Auditoria pré-índice confirmou que nenhum documento canônico possui
    // mais de um tipo. Assim, antecipar a aba (entrada/saída) mantém o mesmo
    // resultado e permite ao PostgreSQL usar a terceira coluna do índice.
    if (filtros.sentido) { params.push(String(filtros.sentido)); condicoesItens.push(`m.tipo=$${params.length}`); }
    const ondeItens=condicoesItens.length ? ` AND ${condicoesItens.join(' AND ')}` : '';
    const base = `WITH canonicos AS (
      SELECT m.*,ROW_NUMBER() OVER (
        PARTITION BY CASE WHEN NULLIF(m.chave,'') IS NOT NULL THEN 'xml:'||m.chave||':'||COALESCE(m.item_numero::text,'__SEM_ITEM__') ELSE 'id:'||m.id::text END
        ORDER BY CASE WHEN NULLIF(BTRIM(COALESCE(m.modelo_documento_fiscal,'')),'') IS NOT NULL THEN 1 ELSE 0 END DESC,
          CASE WHEN NULLIF(BTRIM(COALESCE(m.descricao,'')),'') IS NOT NULL THEN 1 ELSE 0 END DESC,
          CASE WHEN NULLIF(BTRIM(COALESCE(m.ncm,'')),'') IS NOT NULL OR NULLIF(BTRIM(COALESCE(m.nbs,'')),'') IS NOT NULL OR NULLIF(BTRIM(COALESCE(m.lc116,'')),'') IS NOT NULL THEN 1 ELSE 0 END DESC,
          m.id DESC
      ) linha
      FROM public.movimentos m WHERE m.empresa_id=$1${ondeItens}
    ), docs AS (
      SELECT CASE WHEN NULLIF(chave,'') IS NOT NULL THEN 'chave:'||chave ELSE 'movimento:'||id::text END referencia,
       COALESCE(NULLIF(MAX(documento),''),NULLIF(MAX(chave),''),'Lançamento #'||MIN(id)::text) documento,
       MIN(competencia) competencia,MIN(data_emissao) data_emissao,MAX(chave) chave,MAX(tipo) tipo,MAX(origem) origem,MAX(cfop) cfop,
       MAX(nbs) nbs,MAX(lc116) lc116,MAX(iss) iss,MAX(modelo_documento_fiscal) modelo_documento_fiscal,
       MAX(situacao_documento) situacao_documento,MAX(cancelamento_origem) cancelamento_origem,
       MAX(normalizacao_status) normalizacao_status,MAX(normalizacao_evidencia) normalizacao_evidencia,
       MAX(nome) parceiro,MAX(inscr_federal) inscr_federal,MIN(id) item_id,COUNT(*)::int itens,SUM(COALESCE(valor,0)) valor,
       SUM(CASE WHEN NULLIF(ncm,'') IS NOT NULL THEN 1 ELSE 0 END)::int itens_produto,
       SUM(CASE WHEN lower(COALESCE(modelo_documento_fiscal,''))='nfse' THEN 1 ELSE 0 END)::int itens_servico,MAX(criado_em) criado_em
      FROM canonicos WHERE linha=1 GROUP BY CASE WHEN NULLIF(chave,'') IS NOT NULL THEN 'chave:'||chave ELSE 'movimento:'||id::text END
    ) SELECT * FROM docs`;
    const filtro = filtrosSql({ ...filtros, competencia: null, sentido: null }, params);
    // Resultado e página compartilham a mesma CTE: uma ida ao PostgreSQL
    // devolve a página e seu total. Antes eram duas consultas sequenciais
    // (COUNT e SELECT), cujo tempo de rede dominava a leitura aquecida.
    params.push(l, offset);
    const dados = await db.query(`WITH resultado AS (${base} ${filtro}), pagina AS (
      SELECT * FROM resultado
      ORDER BY COALESCE(data_emissao::text,competencia,criado_em::text) DESC,item_id DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    ) SELECT pagina.*, (SELECT COUNT(*)::int FROM resultado) total FROM pagina`, params);
    await db.query('ROLLBACK');
    const total = dados.rows.length ? dados.rows[0].total : 0;
    return { fonte:'SUPABASE_COMPARTILHADO_SOMBRA', documentos:dados.rows, total, exportacao_limitada:exportacao && total > dados.rows.length,
      leitura_metricas:{ tempo_ms:Number((Number(process.hrtime.bigint()-inicio)/1e6).toFixed(1)), total_documentos:total, origem:'FONTE_COMPARTILHADA_DIRETA' },
      limitado: dados.rows.length < total,
      paginacao:{pagina:p,limite:l,totalPaginas:Math.max(1,Math.ceil(total/l)),temAnterior:p>1,temProxima:offset+dados.rows.length<total} };
  } catch (e) { try { await db.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { db.release(); }
}

// As opções do formulário não podem nascer da página atual: isso fazia uma
// competência ou um modelo desaparecer depois de aplicar outro filtro. Esta
// consulta devolve somente metadados distintos da mesma fonte, sem carregar
// documentos, sem sincronização e sem qualquer escrita.
async function listarOpcoesFiltros(cnpj, sentido) {
  if (!process.env.SUPABASE_DB_URL) throw new Error('Fonte compartilhada indisponível para as opções de filtro.');
  const db = await obterPool().connect();
  try {
    await db.query('BEGIN READ ONLY');
    const empresa = await db.query("SELECT id FROM public.empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1 LIMIT 2", [String(cnpj).replace(/\D/g,'')]);
    if (empresa.rows.length !== 1) throw new Error('Empresa compartilhada não identificada unicamente para as opções de filtro.');
    const params = [empresa.rows[0].id];
    let tipoSql = '';
    if (sentido) { params.push(String(sentido)); tipoSql = ` AND tipo=$${params.length}`; }
    const [competencias, modelos] = await Promise.all([
      db.query(`SELECT DISTINCT competencia FROM public.movimentos WHERE empresa_id=$1${tipoSql} AND NULLIF(competencia,'') IS NOT NULL ORDER BY competencia DESC`, params),
      db.query(`SELECT DISTINCT UPPER(COALESCE(NULLIF(modelo_documento_fiscal,''),'NAO_IDENTIFICADO')) modelo FROM public.movimentos WHERE empresa_id=$1${tipoSql} ORDER BY modelo`, params),
    ]);
    await db.query('ROLLBACK');
    return { competencias:competencias.rows.map((r) => r.competencia), modelos:modelos.rows.map((r) => r.modelo), fonte:'SUPABASE_COMPARTILHADO_CONTROLADO' };
  } catch (e) { try { await db.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { db.release(); }
}
module.exports = { listar, listarOpcoesFiltros };

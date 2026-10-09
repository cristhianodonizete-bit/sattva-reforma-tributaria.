/*
 * Consolida cópias idênticas de parceiros na fonte canônica sem DELETE.
 * Uso: node scripts/consolidar_parceiros_canonicos.js <CNPJ> --executar
 * Sem --executar, apenas mostra o que seria alterado.
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
const conteudo = (linha) => JSON.stringify({ tipo:String(linha.tipo || '').toLowerCase(), cnpj:digitos(linha.cnpj), descricao:texto(linha.descricao).toUpperCase(), regime:String(linha.regime || '').toLowerCase() });

async function prepararEstrutura(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS public.parceiros_consolidacoes_auditoria (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    executado_em timestamptz NOT NULL DEFAULT now(),
    empresa_id bigint NOT NULL,
    chave_logica text NOT NULL,
    parceiro_mantido_id bigint NOT NULL,
    parceiro_arquivado_id bigint NOT NULL UNIQUE,
    motivo text NOT NULL,
    copia jsonb NOT NULL
  )`);
  await db.query('ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true');
  await db.query('ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS consolidado_em timestamptz');
  await db.query('ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS consolidado_por_id bigint');
  await db.query('CREATE INDEX IF NOT EXISTS ix_parceiros_ativos_empresa_tipo_cnpj ON public.parceiros (empresa_id,tipo,cnpj) WHERE ativo');
  await db.query(`CREATE OR REPLACE FUNCTION public.bloquear_duplicidade_parceiro_ativo()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF COALESCE(NEW.ativo,true) IS NOT TRUE THEN RETURN NEW; END IF;
      IF NULLIF(regexp_replace(COALESCE(NEW.cnpj,''),'[^0-9]','','g'),'') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.parceiros p WHERE p.ativo IS TRUE AND p.id<>COALESCE(NEW.id,-1)
          AND p.empresa_id=NEW.empresa_id AND p.tipo=NEW.tipo
          AND regexp_replace(COALESCE(p.cnpj,''),'[^0-9]','','g')=regexp_replace(COALESCE(NEW.cnpj,''),'[^0-9]','','g')) THEN
          RAISE EXCEPTION 'Parceiro ativo duplicado para empresa, tipo e CNPJ';
        END IF;
      ELSE
        IF EXISTS (SELECT 1 FROM public.parceiros p WHERE p.ativo IS TRUE AND p.id<>COALESCE(NEW.id,-1)
          AND p.empresa_id=NEW.empresa_id AND p.tipo=NEW.tipo AND NULLIF(regexp_replace(COALESCE(p.cnpj,''),'[^0-9]','','g'),'') IS NULL
          AND upper(COALESCE(p.origem,''))=upper(COALESCE(NEW.origem,''))
          AND lower(COALESCE(p.regime,''))=lower(COALESCE(NEW.regime,''))
          AND upper(regexp_replace(COALESCE(p.descricao,''),'\\s+',' ','g'))=upper(regexp_replace(COALESCE(NEW.descricao,''),'\\s+',' ','g'))) THEN
          RAISE EXCEPTION 'Parceiro genérico ativo duplicado para empresa, tipo, origem, regime e descrição';
        END IF;
      END IF;
      RETURN NEW;
    END $$`);
  await db.query('DROP TRIGGER IF EXISTS trg_bloquear_duplicidade_parceiro_ativo ON public.parceiros');
  await db.query('CREATE TRIGGER trg_bloquear_duplicidade_parceiro_ativo BEFORE INSERT OR UPDATE OF empresa_id,tipo,cnpj,descricao,regime,origem,ativo ON public.parceiros FOR EACH ROW EXECUTE FUNCTION public.bloquear_duplicidade_parceiro_ativo()');
}

async function main() {
  const cnpj = digitos(process.argv[2]);
  const executar = process.argv.includes('--executar');
  if (cnpj.length !== 14) throw new Error('Informe o CNPJ da empresa com 14 dígitos.');
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
  const db = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await db.connect();
  try {
    await db.query('BEGIN');
    const empresa = await db.query("SELECT id,cnpj,razao_social FROM public.empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1 LIMIT 2 FOR UPDATE", [cnpj]);
    if (empresa.rows.length !== 1) throw new Error('Empresa canônica não identificada de forma única.');
    const empresaId = Number(empresa.rows[0].id);
    if (executar) await prepararEstrutura(db);
    const linhas = await db.query(`SELECT * FROM public.parceiros WHERE empresa_id=$1${executar ? ' AND ativo IS TRUE' : ''} ORDER BY criado_em DESC NULLS LAST,id DESC FOR UPDATE`, [empresaId]);
    const grupos = new Map();
    for (const linha of linhas.rows) { const grupo=grupos.get(chave(linha)) || []; grupo.push(linha); grupos.set(chave(linha),grupo); }
    const candidatas = [...grupos.entries()].filter(([, grupo]) => grupo.length > 1 && new Set(grupo.map(conteudo)).size === 1);
    const arquivar = candidatas.flatMap(([identidade, grupo]) => grupo.slice(1).map((linha) => ({ identidade, manter:grupo[0], linha })));
    if (!executar) {
      await db.query('ROLLBACK');
      console.log(JSON.stringify({ somente_previa:true, empresa:empresa.rows[0], grupos:candidatas.length, copias_a_arquivar:arquivar.length }, null, 2));
      return;
    }
    // Materializa as cópias em uma tabela temporária e arquiva em lote. A
    // primeira versão fazia uma ida ao banco por cópia; com milhares de
    // linhas isso prolongava a transação e bloqueava a tabela desnecessariamente.
    await db.query(`CREATE TEMP TABLE consolidacao_parceiros_lote ON COMMIT DROP AS
      WITH base AS (
        SELECT p.*, CASE
          WHEN NULLIF(regexp_replace(COALESCE(p.cnpj,''),'[^0-9]','','g'),'') IS NOT NULL
            THEN 'CNPJ|'||lower(p.tipo)||'|'||regexp_replace(p.cnpj,'[^0-9]','','g')
          ELSE 'GENERICO|'||lower(p.tipo)||'|'||upper(COALESCE(p.origem,''))||'|'||lower(COALESCE(p.regime,''))||'|'||upper(regexp_replace(COALESCE(p.descricao,''),'\\s+',' ','g'))
        END AS chave_logica,
        lower(p.tipo)||'|'||regexp_replace(COALESCE(p.cnpj,''),'[^0-9]','','g')||'|'||upper(regexp_replace(COALESCE(p.descricao,''),'\\s+',' ','g'))||'|'||lower(COALESCE(p.regime,'')) AS conteudo
        FROM public.parceiros p WHERE p.empresa_id=$1 AND p.ativo IS TRUE
      ), grupos AS (
        SELECT chave_logica FROM base GROUP BY chave_logica HAVING count(*)>1 AND count(DISTINCT conteudo)=1
      ), classificados AS (
        SELECT b.*, first_value(id) OVER (PARTITION BY chave_logica ORDER BY criado_em DESC NULLS LAST,id DESC) AS parceiro_mantido_id,
          row_number() OVER (PARTITION BY chave_logica ORDER BY criado_em DESC NULLS LAST,id DESC) AS posicao
        FROM base b JOIN grupos g USING (chave_logica)
      ) SELECT chave_logica,parceiro_mantido_id,id AS parceiro_arquivado_id,to_jsonb(classificados) AS copia
      FROM classificados WHERE posicao>1`, [empresaId]);
    await db.query(`INSERT INTO public.parceiros_consolidacoes_auditoria
      (empresa_id,chave_logica,parceiro_mantido_id,parceiro_arquivado_id,motivo,copia)
      SELECT $1,chave_logica,parceiro_mantido_id,parceiro_arquivado_id,'COPIA_TECNICA_IDENTICA',copia
      FROM consolidacao_parceiros_lote ON CONFLICT (parceiro_arquivado_id) DO NOTHING`, [empresaId]);
    const atualizacao = await db.query(`UPDATE public.parceiros p SET ativo=false,consolidado_em=now(),consolidado_por_id=l.parceiro_mantido_id
      FROM consolidacao_parceiros_lote l WHERE p.id=l.parceiro_arquivado_id AND p.ativo IS TRUE`);
    const restante = await db.query(`SELECT COUNT(*)::int total FROM (
      SELECT 1 FROM public.parceiros WHERE empresa_id=$1 AND ativo IS TRUE
      GROUP BY tipo,CASE WHEN NULLIF(regexp_replace(COALESCE(cnpj,''),'[^0-9]','','g'),'') IS NOT NULL THEN regexp_replace(cnpj,'[^0-9]','','g') ELSE upper(COALESCE(origem,''))||'|'||lower(COALESCE(regime,''))||'|'||upper(regexp_replace(COALESCE(descricao,''),'\\s+',' ','g')) END
      HAVING COUNT(*)>1) duplicados`,[empresaId]);
    if (Number(restante.rows[0].total) !== 0) throw new Error(`Consolidação interrompida: restaram ${restante.rows[0].total} grupos ativos duplicados.`);
    await db.query('COMMIT');
    console.log(JSON.stringify({ executado:true, empresa:empresa.rows[0], linhas_arquivadas:atualizacao.rowCount, grupos_consolidados:candidatas.length, grupos_ativos_duplicados:0 }, null, 2));
  } catch (erro) {
    try { await db.query('ROLLBACK'); } catch (_) { /* já encerrada */ }
    throw erro;
  } finally { await db.end(); }
}
main().catch((erro) => { console.error(erro.message); process.exitCode = 1; });

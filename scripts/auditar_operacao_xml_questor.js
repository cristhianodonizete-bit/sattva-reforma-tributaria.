/* Auditoria somente leitura da operação documental e Questor.
 * Não grava, não sincroniza e não reprocessa dados. */
require('dotenv').config();
const { Client } = require('pg');

async function existe(client, tabela) {
  const r = await client.query('SELECT to_regclass($1) AS tabela', [`public.${tabela}`]);
  return Boolean(r.rows[0]?.tabela);
}
async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const empresas = (await client.query(`SELECT id,razao_social FROM public.empresas
      WHERE upper(razao_social) LIKE '%TRUSTON%' ORDER BY id`)).rows;
    const ids = empresas.map((x) => x.id);
    if (!ids.length) return console.log(JSON.stringify({ empresas: [], aviso: 'Empresa de auditoria não localizada.' }, null, 2));
    const movimentos = (await client.query(`SELECT empresa_id,lower(COALESCE(modelo_documento_fiscal,'')) modelo,
      COUNT(*) itens,COUNT(DISTINCT NULLIF(chave,'')) documentos,
      COUNT(*) FILTER (WHERE COALESCE(ncm,'')<>'') com_ncm,
      COUNT(*) FILTER (WHERE COALESCE(cfop,'')<>'') com_cfop,
      COUNT(*) FILTER (WHERE COALESCE(lc116,'')<>'' OR COALESCE(nbs,'')<>'') com_chave_servico,
      COUNT(*) FILTER (WHERE lower(COALESCE(modelo_documento_fiscal,'')) IN ('nfe','nfce') AND COALESCE(lc116,'')=substr(COALESCE(cst,''),1,4) AND COALESCE(lc116,'')<>'') lc116_indevado
      FROM public.movimentos WHERE empresa_id = ANY($1) AND lower(COALESCE(origem,''))='xml'
      GROUP BY empresa_id,lower(COALESCE(modelo_documento_fiscal,'')) ORDER BY empresa_id,modelo`, [ids])).rows;
    const competencias = (await client.query(`SELECT empresa_id,competencia,COUNT(*) itens,
      COUNT(*) FILTER (WHERE lower(COALESCE(modelo_documento_fiscal,'')) IN ('nfe','nfce')) itens_produto,
      COUNT(*) FILTER (WHERE lower(COALESCE(modelo_documento_fiscal,''))='nfse') itens_servico,
      COALESCE(SUM(valor) FILTER (WHERE tipo='cliente' AND sentido='saida'),0) saidas_brutas
      FROM public.movimentos WHERE empresa_id=ANY($1) AND lower(COALESCE(origem,''))='xml'
      GROUP BY empresa_id,competencia ORDER BY empresa_id,competencia DESC`, [ids])).rows;
    const duplicidades = (await client.query(`SELECT empresa_id,chave,COUNT(*) itens,COUNT(DISTINCT documento) documentos
      FROM public.movimentos WHERE empresa_id=ANY($1) AND COALESCE(chave,'')<>''
      GROUP BY empresa_id,chave HAVING COUNT(DISTINCT documento)>1 ORDER BY itens DESC LIMIT 20`, [ids])).rows;
    const amostraNfeComServico = (await client.query(`SELECT id,competencia,documento,chave,ncm,cfop,cst,nbs,lc116,iss,valor
      FROM public.movimentos WHERE empresa_id=ANY($1) AND lower(COALESCE(origem,''))='xml'
        AND lower(COALESCE(modelo_documento_fiscal,'')) IN ('nfe','nfce')
        AND (COALESCE(lc116,'')<>'' OR COALESCE(nbs,'')<>'' OR COALESCE(iss,0)<>0)
      ORDER BY id LIMIT 40`, [ids])).rows;
    const tarefas = await existe(client, 'questor_conector_tarefas')
      ? (await client.query(`SELECT empresa_id,tipo,status,COUNT(*) quantidade,MAX(executado_em) ultima_execucao,
          MAX(LEFT(COALESCE(erro,''),180)) ultimo_erro
          FROM public.questor_conector_tarefas WHERE empresa_id=ANY($1)
          GROUP BY empresa_id,tipo,status ORDER BY empresa_id,tipo,status`, [ids])).rows : [];
    const periodo = await existe(client, 'empresa_periodo_analisado')
      ? (await client.query(`SELECT empresa_id,competencia_inicio,competencia_fim,apuracao_meses,apuracao_inclui_exercicio,atualizado_em
          FROM public.empresa_periodo_analisado WHERE empresa_id=ANY($1)`, [ids])).rows : [];
    console.log(JSON.stringify({
      escopo: 'somente leitura', empresas, periodo, xml_por_modelo: movimentos,
      xml_por_competencia: competencias, chaves_com_documentos_divergentes: duplicidades,
      amostra_nfe_com_campos_de_servico: amostraNfeComServico,
      fila_questor: tarefas,
    }, null, 2));
  } finally { await client.end(); }
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });

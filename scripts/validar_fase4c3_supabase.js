/* Validação somente leitura do schema da ingestão de apurações. */
require('dotenv').config();
const { Client } = require('pg');
const tabelas = ['pis_cofins_apuracao_documentos', 'pis_cofins_apuracoes_historicas', 'pis_cofins_apuracao_campos'];
const esperadas = {
  pis_cofins_apuracao_documentos: ['empresa_id', 'nome_original', 'tipo_documento', 'conteudo_original', 'hash_sha256', 'competencia_detectada', 'versao_modelo_extracao'],
  pis_cofins_apuracoes_historicas: ['empresa_id', 'documento_id', 'competencia', 'pis_debito', 'cofins_debito', 'pis_credito', 'cofins_credito', 'status_validacao'],
  pis_cofins_apuracao_campos: ['apuracao_id', 'campo', 'valor_extraido', 'pagina_ou_localizacao', 'confianca', 'metodo_extracao', 'status_validacao'],
};
(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const colunas = await client.query(`select table_name,column_name from information_schema.columns where table_schema='public' and table_name=any($1)`, [tabelas]);
    const faltantes = Object.fromEntries(tabelas.map((t) => [t, esperadas[t].filter((c) => !colunas.rows.some((x) => x.table_name === t && x.column_name === c))]));
    const rls = await client.query(`select relname,relrowsecurity from pg_class where relname=any($1)`, [tabelas]);
    console.log(JSON.stringify({ tabelas: tabelas.filter((t) => colunas.rows.some((x) => x.table_name === t)), faltantes, rls: rls.rows }, null, 2));
    if (Object.values(faltantes).some((x) => x.length)) process.exitCode = 2;
  } finally { await client.end(); }
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });

require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const contrato = await client.query("select dados from public.parametros_operacionais where tabela='contrato_tecnico' and chave='pis_cofins_percentual'");
    const tabelas = await client.query("select to_regclass('public.regras_enquadramento') regras, to_regclass('public.base_ncm') ncm, to_regclass('public.base_servicos') servicos, to_regclass('public.empresa_produto_fiscal') cadastro_fiscal");
    const colunas = await client.query("select table_name,column_name from information_schema.columns where table_schema='public' and ((table_name='regras_enquadramento' and column_name in ('regime_pis_cofins','cst_pis','cst_cofins','pis_percentual','cofins_percentual','ncm','nbs','lc116','condicoes_obrigatorias','tratamento_resultante','status')) or (table_name='empresa_produto_fiscal' and column_name in ('possui_sintetizador_voz','adaptado_para_pessoa_com_deficiencia','acionador_pressao'))) order by table_name,column_name");
    const lote = await client.query("select status,count(*)::int quantidade from public.regras_enquadramento where id like 'RASCUNHO_FINAL_%' group by status order by status");
    console.log(JSON.stringify({ contrato: contrato.rows[0]?.dados || null, tabelas: tabelas.rows[0], colunas: colunas.rows, lote: lote.rows }, null, 2));
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.message); process.exit(1); });

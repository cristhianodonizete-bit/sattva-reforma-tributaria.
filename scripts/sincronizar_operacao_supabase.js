/* Sincroniza os registros operacionais completos do SQLite para o Supabase. */
require('dotenv').config();
const { Pool } = require('pg');
const db = require('../src/db');

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL não configurada.');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const esquemas = {
  empresas: { id: 'bigint primary key', cnpj: 'text', razao_social: 'text', nome_fantasia: 'text', regime: 'text', uf: 'text', municipio: 'text', cnae: 'text', atividade: 'text', faturamento_anual: 'numeric', setor: 'text', reducao_padrao: 'text', codigo_questor: 'text', observacoes: 'text', criado_em: 'text' },
  parceiros: { id: 'bigint primary key', empresa_id: 'bigint', tipo: 'text', cnpj: 'text', descricao: 'text', regime: 'text', faturamento_anual: 'numeric', uf: 'text', municipio: 'text', origem: 'text', criado_em: 'text', regime_resolvido: 'text', perfil_economico: 'text', perfil_origem: 'text', sensibilidade_credito: 'text', sensibilidade_origem: 'text' },
  lotes: { id: 'bigint primary key', empresa_id: 'bigint', tipo: 'text', arquivo: 'text', registros: 'integer', ignorados: 'integer', valor_total: 'numeric', mensagens: 'text', origem: 'text', criado_em: 'text' },
  movimentos: { id: 'bigint primary key', empresa_id: 'bigint', lote_id: 'bigint', tipo: 'text', nome: 'text', inscr_federal: 'text', descricao: 'text', ncm: 'text', nbs: 'text', cfop: 'text', cst: 'text', competencia: 'text', valor: 'numeric', base_calculo: 'numeric', icms: 'numeric', icms_st: 'numeric', ipi: 'numeric', pis: 'numeric', cofins: 'numeric', iss: 'numeric', regime: 'text', reducao: 'text', aliq_especifica: 'numeric', cclasstrib: 'text', classificacao_origem: 'text', cst_declarado: 'text', cclasstrib_declarado: 'text', ibs_declarado: 'numeric', cbs_declarado: 'numeric', documento: 'text', item_numero: 'integer', chave: 'text', emitente_cnpj: 'text', destinatario_cnpj: 'text', codigo_produto: 'text', quantidade: 'numeric', unidade: 'text', csosn: 'text', data_emissao: 'text', frete: 'numeric', seguro: 'numeric', outras: 'numeric', desconto: 'numeric', sentido: 'text', origem: 'text', criado_em: 'text' },
  perfil_tributario: { id: 'bigint primary key', empresa_id: 'bigint', competencia: 'text', receita_bruta: 'numeric', receita_mercadorias: 'numeric', receita_servicos: 'numeric', receita_exportacao: 'numeric', icms: 'numeric', iss: 'numeric', ipi: 'numeric', pis: 'numeric', cofins: 'numeric', das: 'numeric', creditos_tomados: 'numeric', origem: 'text', criado_em: 'text' },
};

async function preparar(client) {
  for (const [tabela, cols] of Object.entries(esquemas)) {
    await client.query(`CREATE TABLE IF NOT EXISTS public.${tabela} (${Object.entries(cols).map(([n, t]) => `${n} ${t}`).join(', ')})`);
    for (const [nome, tipo] of Object.entries(cols)) {
      if (nome === 'id') continue;
      await client.query(`ALTER TABLE public.${tabela} ADD COLUMN IF NOT EXISTS ${nome} ${tipo}`);
    }
  }
}
async function enviar(client, tabela, cols) {
  const linhas = db.prepare(`SELECT ${cols.join(',')} FROM ${tabela}`).all();
  const tamanho = 150;
  for (let i = 0; i < linhas.length; i += tamanho) {
    const lote = linhas.slice(i, i + tamanho);
    const valores = [], params = [];
    lote.forEach((linha, a) => {
      const base = a * cols.length;
      valores.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`);
      for (const c of cols) params.push(linha[c] ?? null);
    });
    const atualiza = cols.filter((c) => c !== 'id').map((c) => `${c}=EXCLUDED.${c}`).join(',');
    await client.query(`INSERT INTO public.${tabela} (${cols.join(',')}) VALUES ${valores.join(',')} ON CONFLICT (id) DO UPDATE SET ${atualiza}`, params);
  }
  return linhas.length;
}
async function executar() {
  const client = await pool.connect();
  try {
    await preparar(client);
    const resultado = {};
    for (const [t, cols] of Object.entries(esquemas)) resultado[t] = await enviar(client, t, Object.keys(cols));
    console.log(JSON.stringify(resultado));
  } finally { client.release(); await pool.end(); }
}
if (require.main === module) executar().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
module.exports = { executar };

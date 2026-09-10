/* Estado de cancelamento é dado fiscal primário e deve sobreviver ao cache do Render. */
require('dotenv').config();
const { Client } = require('pg');

const SQL = `
ALTER TABLE public.movimentos ADD COLUMN IF NOT EXISTS situacao_documento text DEFAULT 'AUTORIZADO';
ALTER TABLE public.movimentos ADD COLUMN IF NOT EXISTS cancelado_em text;
ALTER TABLE public.movimentos ADD COLUMN IF NOT EXISTS cancelamento_motivo text;
ALTER TABLE public.movimentos ADD COLUMN IF NOT EXISTS cancelamento_origem text;
CREATE INDEX IF NOT EXISTS ix_movimentos_empresa_situacao_documento
  ON public.movimentos (empresa_id, situacao_documento);
`;

async function executar() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try { await client.query(SQL); console.log('Cancelamento fiscal: schema Supabase pronto.'); }
  finally { await client.end(); }
}
if (require.main === module) executar().catch((e) => { console.error(`ERRO: ${e.message}`); process.exitCode = 1; });
module.exports = { executar };

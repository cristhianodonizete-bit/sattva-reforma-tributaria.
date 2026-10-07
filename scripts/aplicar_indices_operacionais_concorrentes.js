// Aplica índices sem bloquear leituras/escritas da plataforma. Não use o
// aplicador genérico de migrations: CREATE INDEX CONCURRENTLY é proibido em
// transações PostgreSQL.
require('dotenv').config();
const { Client } = require('pg');

if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

const comandos = [
  'create extension if not exists pg_trgm',
  `create index concurrently if not exists ix_questor_pessoas_nome_trgm
     on public.questor_pessoas using gin (nome gin_trgm_ops)
     where inscr_federal is not null`,
  `create index concurrently if not exists ix_movimentos_empresa_origem_nome
     on public.movimentos (empresa_id, origem, nome)
     where origem = 'QUESTOR_RAZAO'`,
  `create index concurrently if not exists ix_parceiros_empresa_tipo_cnpj
     on public.parceiros (empresa_id, tipo, cnpj)`,
  'analyze public.questor_pessoas',
  'analyze public.movimentos',
  'analyze public.parceiros',
];

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized:false } });
  await client.connect();
  try {
    for (const comando of comandos) {
      console.log(`Executando: ${comando.replace(/\s+/g,' ').trim()}`);
      await client.query(comando);
    }
    console.log('Índices operacionais aplicados e estatísticas atualizadas.');
  } finally {
    await client.end();
  }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exitCode=1; });

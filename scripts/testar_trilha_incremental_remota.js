require('dotenv').config();
const { Client } = require('pg');

async function executar() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const gatilhos = await client.query(`
      SELECT c.relname AS tabela
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND t.tgname='trg_sync_operacional_evento'
    `);
    const tabelasComGatilho = new Set(gatilhos.rows.map((x) => x.tabela));
    const essenciais = ['empresas', 'parceiros', 'lotes', 'movimentos', 'empresa_qsa'];
    const ausentes = essenciais.filter((tabela) => !tabelasComGatilho.has(tabela));
    if (ausentes.length) throw new Error(`Gatilho incremental ausente em: ${ausentes.join(', ')}`);
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE sync_probe (id bigint primary key, empresa_id bigint, segredo text)');
    await client.query('CREATE TRIGGER trg_probe AFTER INSERT OR UPDATE OR DELETE ON sync_probe FOR EACH ROW EXECUTE FUNCTION public.registrar_evento_sincronizacao_operacional()');
    await client.query("INSERT INTO sync_probe VALUES (77, 11, 'nao-persistir')");
    await client.query("UPDATE sync_probe SET segredo='alterado' WHERE id=77");
    await client.query('DELETE FROM sync_probe WHERE id=77');
    const eventos = await client.query("SELECT operacao, chave, empresa_id FROM public.sincronizacao_operacional_eventos WHERE tabela='sync_probe' ORDER BY sequencia");
    const operacoes = eventos.rows.map((x) => x.operacao).join(',');
    const validos = eventos.rowCount === 3
      && operacoes === 'INSERT,UPDATE,DELETE'
      && eventos.rows.every((x) => JSON.stringify(x.chave) === '{"id":77}' && x.empresa_id === '11');
    if (!validos) throw new Error(`Trilha incremental inválida: ${JSON.stringify(eventos.rows)}`);
    console.log(`Probe transacional validado: ${tabelasComGatilho.size} tabelas protegidas; INSERT, UPDATE e DELETE registram somente chave e empresa.`);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

executar().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });

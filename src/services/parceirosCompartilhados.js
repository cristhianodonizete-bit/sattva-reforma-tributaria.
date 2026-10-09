// Leitura oficial do cadastro de parceiros. A interface nunca usa SQLite
// como verdade para este recorte: o SQLite permanece restrito ao cache e ao
// contexto de execução do motor.
const { Pool } = require('pg');

let pool = null;
function obterPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

function chaveLogica(linha = {}) {
  const cnpj = String(linha.cnpj || '').replace(/\D/g, '');
  if (cnpj) return `CNPJ:${cnpj}`;
  return `GENERICO:${String(linha.origem || '').trim().toUpperCase()}|${String(linha.regime || '').trim().toLowerCase()}|${String(linha.descricao || '').trim().replace(/\s+/g, ' ').toUpperCase()}`;
}

async function listar(cnpjEmpresa, tipo = '') {
  if (!process.env.SUPABASE_DB_URL) throw new Error('Fonte compartilhada indisponível para o cadastro oficial de parceiros.');
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN READ ONLY');
    const empresa = await cliente.query("SELECT id FROM public.empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1 LIMIT 2", [String(cnpjEmpresa || '').replace(/\D/g, '')]);
    if (empresa.rows.length !== 1) throw new Error('Empresa compartilhada não identificada unicamente para leitura de parceiros.');
    const parametros = [empresa.rows[0].id];
    const filtroTipo = tipo ? (parametros.push(String(tipo)), ` AND tipo=$${parametros.length}`) : '';
    const dados = await cliente.query(`SELECT id,tipo,cnpj,descricao,regime,faturamento_anual,uf,municipio,origem,criado_em
      FROM public.parceiros WHERE empresa_id=$1 AND COALESCE(ativo,true) IS TRUE${filtroTipo}
      ORDER BY tipo, descricao, criado_em DESC NULLS LAST, id DESC`, parametros);
    await cliente.query('ROLLBACK');

    // Cópias técnicas não podem fazer a tela exibir fornecedores repetidos.
    // O relatório de auditoria continua vendo a quantidade bruta; aqui a
    // projeção de leitura escolhe deterministicamente a linha mais recente.
    const porChave = new Map();
    for (const linha of dados.rows) {
      const chave = `${String(linha.tipo || '').toLowerCase()}|${chaveLogica(linha)}`;
      if (!porChave.has(chave)) porChave.set(chave, linha);
    }
    const parceiros = [...porChave.values()].sort((a, b) => String(a.tipo || '').localeCompare(String(b.tipo || '')) || String(a.descricao || '').localeCompare(String(b.descricao || '')));
    return {
      parceiros,
      fonte: 'SUPABASE_CANONICA',
      leitura_metricas: { registros_canonicos: dados.rows.length, parceiros_logicos: parceiros.length, duplicidades_tecnicas_ocultas: dados.rows.length - parceiros.length },
    };
  } catch (erro) {
    try { await cliente.query('ROLLBACK'); } catch (_) { /* transação já encerrada */ }
    throw erro;
  } finally { cliente.release(); }
}

module.exports = { listar, chaveLogica };

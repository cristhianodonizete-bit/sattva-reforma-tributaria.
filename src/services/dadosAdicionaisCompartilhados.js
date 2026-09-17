// Persistência pontual dos dados adicionais. Não usa a fotografia operacional
// inteira: estas telas precisam sobreviver ao reinício do Render sem aguardar
// a sincronização de documentos, motor e precificação.
const supabase = require('./supabase');

const ESPELHOS = [
  ['folhas_pagamento_competencias', 'empresa_id,competencia'],
  ['margens_operacionais_premissas', 'empresa_id,periodo_inicio,periodo_fim'],
  ['receitas_sem_dfe', 'empresa_id,chave_deduplicacao'],
];

async function empresaRemota(remoto, empresaLocalId) {
  const { data, error } = await remoto.from('empresas').select('id').eq('origem_local_id', Number(empresaLocalId));
  if (error) throw new Error(`Empresa compartilhada: ${error.message}`);
  if (data?.length !== 1) throw new Error('Empresa remota não localizada de forma única para os dados adicionais.');
  return data[0].id;
}

async function publicar(db, empresaLocalId) {
  if (!supabase.configurado()) return { ativo:false };
  const remoto = supabase.admin();
  const empresaIdRemota = await empresaRemota(remoto, empresaLocalId);
  const resultado = {};
  for (const [tabela, conflito] of ESPELHOS) {
    const linhas = db.prepare(`SELECT * FROM ${tabela} WHERE empresa_id=?`).all(empresaLocalId)
      .map(({ id, ...linha }) => ({ ...linha, empresa_id:empresaIdRemota }));
    if (!linhas.length) { resultado[tabela] = 0; continue; }
    const { error } = await remoto.from(tabela).upsert(linhas, { onConflict:conflito });
    if (error) throw new Error(`${tabela}: ${error.message}`);
    resultado[tabela] = linhas.length;
  }
  return { ativo:true, empresa_id_remota:empresaIdRemota, ...resultado };
}

function gravarLocal(db, tabela, empresaLocalId, linhas, conflito) {
  if (!linhas.length) return 0;
  const permitidas = new Set(db.prepare(`PRAGMA table_info(${tabela})`).all().map((x) => x.name));
  const colunas = Object.keys(linhas[0]).filter((c) => c !== 'id' && permitidas.has(c));
  const atualizaveis = colunas.filter((c) => c !== 'empresa_id' && !['competencia','periodo_inicio','periodo_fim','chave_deduplicacao'].includes(c));
  const sql = `INSERT INTO ${tabela} (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')})
    ON CONFLICT(${conflito}) DO UPDATE SET ${atualizaveis.map((c) => `${c}=excluded.${c}`).join(',')}`;
  const inserir = db.prepare(sql);
  db.transaction(() => linhas.forEach((linha) => inserir.run(...colunas.map((c) => c === 'empresa_id' ? empresaLocalId : linha[c]))))();
  return linhas.length;
}

async function restaurar(db, empresaLocalId) {
  if (!supabase.configurado()) return { ativo:false };
  const remoto = supabase.admin();
  const empresaIdRemota = await empresaRemota(remoto, empresaLocalId);
  const resultado = {};
  for (const [tabela, conflito] of ESPELHOS) {
    const { data, error } = await remoto.from(tabela).select('*').eq('empresa_id', empresaIdRemota);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    resultado[tabela] = gravarLocal(db, tabela, empresaLocalId, data || [], conflito.replace('empresa_id,', 'empresa_id,'));
  }
  return { ativo:true, ...resultado };
}

module.exports = { publicar, restaurar };

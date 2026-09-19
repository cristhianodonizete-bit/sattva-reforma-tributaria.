/*
 * Estado versionado das projeções de leitura por empresa.
 *
 * Não é um cache de valores fiscais e não substitui nenhuma tabela de origem.
 * Ele informa somente se uma projeção local pode ser usada, qual foi a última
 * atualização e quais recursos devem ser recarregados depois de uma escrita.
 */
const RECURSOS = new Set([
  'documentos', 'cancelamentos', 'parceiros', 'receitas', 'apuracoes', 'pgdas',
  'periodo', 'prontidao', 'perfil', 'motor', 'cadeias', 'cenarios',
  'precificacao', 'configuracao',
]);
const sincronizacoesEmAndamento = new Map();

function recursosValidos(recursos) {
  const itens = Array.isArray(recursos) ? recursos : [recursos];
  return [...new Set(itens.map((x) => String(x || '').trim()).filter((x) => RECURSOS.has(x)))];
}

function estado(db, empresaId, recursos = [...RECURSOS]) {
  const ids = recursosValidos(recursos);
  if (!ids.length) return [];
  const marcas = ids.map(() => '?').join(',');
  const existentes = db.prepare(`SELECT recurso,versao,situacao,motivo,atualizado_em,sincronizado_em,erro
    FROM empresa_leituras_estado WHERE empresa_id=? AND recurso IN (${marcas})`).all(Number(empresaId), ...ids);
  const porRecurso = new Map(existentes.map((x) => [x.recurso, x]));
  return ids.map((recurso) => porRecurso.get(recurso) || ({
    recurso, versao: 0, situacao: 'AINDA_NAO_SINCRONIZADO', motivo: null,
    atualizado_em: null, sincronizado_em: null, erro: null,
  }));
}

function registrar(db, empresaId, recursos, { situacao = 'ATUALIZADO', motivo = null, erro = null, sincronizado = false } = {}) {
  const ids = recursosValidos(recursos);
  if (!ids.length) return [];
  const agora = new Date().toISOString();
  const gravar = db.prepare(`INSERT INTO empresa_leituras_estado
    (empresa_id,recurso,versao,situacao,motivo,atualizado_em,sincronizado_em,erro)
    VALUES (?,?,1,?,?,?,?,?)
    ON CONFLICT(empresa_id,recurso) DO UPDATE SET
      versao=empresa_leituras_estado.versao+1, situacao=excluded.situacao,
      motivo=excluded.motivo, atualizado_em=excluded.atualizado_em,
      sincronizado_em=excluded.sincronizado_em, erro=excluded.erro`);
  db.transaction(() => ids.forEach((recurso) => gravar.run(
    Number(empresaId), recurso, situacao, motivo, agora, sincronizado ? agora : null, erro,
  )))();
  return estado(db, empresaId, ids);
}

function invalidar(db, empresaId, recursos, motivo) {
  return registrar(db, empresaId, recursos, { situacao:'ATUALIZACAO_PENDENTE', motivo: motivo || 'Alteração de dados', erro:null });
}

function sincronizado(db, empresaId, recursos, motivo = 'Sincronização concluída') {
  const ids = recursosValidos(recursos);
  if (!ids.length) return [];
  const agora = new Date().toISOString();
  const gravar = db.prepare(`INSERT INTO empresa_leituras_estado
    (empresa_id,recurso,versao,situacao,motivo,atualizado_em,sincronizado_em,erro)
    VALUES (?,?,1,'ATUALIZADO',?,?,?,NULL)
    ON CONFLICT(empresa_id,recurso) DO UPDATE SET
      situacao='ATUALIZADO', motivo=excluded.motivo,
      atualizado_em=excluded.atualizado_em, sincronizado_em=excluded.sincronizado_em, erro=NULL`);
  db.transaction(() => ids.forEach((recurso) => gravar.run(Number(empresaId), recurso, motivo, agora, agora)))();
  return estado(db, empresaId, ids);
}

function falhou(db, empresaId, recursos, erro) {
  return registrar(db, empresaId, recursos, { situacao:'ULTIMA_FOTOGRAFIA_VALIDA', motivo:'Falha na atualização', erro:String(erro || 'Falha não detalhada') });
}

// Não armazena resultado remoto: apenas evita que duas telas consultem a mesma
// fonte imediatamente uma após a outra. Uma escrita marca o recurso como
// pendente e elimina o atalho automaticamente.
async function atualizarComSeguranca(db, empresaId, recursos, executar, { maxAgeMs = 10000, motivo = 'Fonte conferida' } = {}) {
  const ids = recursosValidos(recursos);
  const atual = estado(db, empresaId, ids);
  const agora = Date.now();
  const fresco = atual.length === ids.length && atual.every((x) => x.situacao === 'ATUALIZADO'
    && x.sincronizado_em && agora - Date.parse(x.sincronizado_em) < maxAgeMs);
  if (fresco) return { origem:'LEITURA_LOCAL_RECENTE', resultado:null };
  const chave = `${Number(empresaId)}:${ids.slice().sort().join(',')}`;
  if (sincronizacoesEmAndamento.has(chave)) return sincronizacoesEmAndamento.get(chave);
  const promessa = (async () => {
    try {
      const resultado = await executar();
      sincronizado(db, empresaId, ids, motivo);
      return { origem:'FONTE_COMPARTILHADA', resultado };
    } catch (erro) {
      falhou(db, empresaId, ids, erro.message);
      throw erro;
    }
  })();
  sincronizacoesEmAndamento.set(chave, promessa);
  try { return await promessa; }
  finally { sincronizacoesEmAndamento.delete(chave); }
}

module.exports = { RECURSOS, estado, invalidar, sincronizado, falhou, recursosValidos, atualizarComSeguranca };

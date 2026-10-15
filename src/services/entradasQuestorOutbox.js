// Outbox das entradas Questor (plano aprovado: plano-outbox-entradas-questor.md).
// Contrato operacional:
// - A tabela existe só após a migração explícita (entradasQuestorMigracao).
// - Após a migração, novos lançamentos entram na outbox na mesma transação do
//   movimento, com ENTRADAS_OUTBOX_ATIVA desligada ou ligada.
// - ENTRADAS_OUTBOX_ATIVA controla somente o bloco visual e o worker automático.
// - Antes da migração, as escritas são no-op e o backfill cobre o intervalo.
// - ESCOPO PENDENTE (I4): REABERTURA_POR_AUSENCIA ainda não está implementada.
//   Não há reabertura por leitura de tela. Exige job paginado, duas passagens
//   completas separadas por uma hora e auditoria por item.
const crypto = require('crypto');
const db = require('../db');

const LIMITE_TENTATIVAS = 5;
// Após a tentativa k falhar (k = 1..4), espera BACKOFF_MS[k-1]. Após a quinta, definitivo.
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const LEASE_MS = 5 * 60_000;
const ORIGENS = ['QUESTOR_CONCILIACAO_ENTRADA', 'QUESTOR_RAZAO'];

const ativa = () => process.env.ENTRADAS_OUTBOX_ATIVA === 'true';
const iso = (d) => new Date(d).toISOString();
const agoraIso = () => iso(Date.now());

let tabelaConhecida = false;
function tabelaPresente() {
  if (tabelaConhecida) return true;
  const existe = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='entradas_questor_publicacao'").get();
  if (existe) tabelaConhecida = true;
  return existe;
}

// I5: sem chave_publicacao o registro nasce definitivamente falho, visível.
// I6: chamada dentro da mesma transação que cria/confirma o movimento.
function registrarPendente({ empresa_id, movimento_id = null, origem, identidade_outbox, item_numero = 0, chave_publicacao = null, agora = agoraIso() }) {
  if (!tabelaPresente()) return false;
  if (!ORIGENS.includes(origem)) throw new Error(`origem fora da outbox: ${origem}`);
  if (!identidade_outbox) throw new Error('identidade_outbox obrigatória');
  const semChave = !String(chave_publicacao || '').trim();
  const estado = semChave ? 'FALHOU_DEFINITIVO' : 'PENDENTE';
  const erro = semChave ? 'SEM_CHAVE_PUBLICAVEL' : null;
  const r = db.prepare(`INSERT INTO entradas_questor_publicacao
      (empresa_id, movimento_id, origem, identidade_outbox, item_numero, chave_publicacao, estado, tentativas, ultimo_erro, criado_em, atualizado_em)
    VALUES (?,?,?,?,?,?,?,0,?,?,?)
    ON CONFLICT (empresa_id, origem, identidade_outbox, item_numero) DO NOTHING`)
    .run(Number(empresa_id), movimento_id, origem, String(identidade_outbox), Number(item_numero), chave_publicacao, estado, erro, agora, agora);
  return r.changes === 1;
}

// PREVIA_MATERIALIZADA (I2): só vincula movimento_id; estado, tentativas e erro são preservados.
function materializarPrevia({ empresa_id, origem, identidade_outbox, item_numero = 0, movimento_id, agora = agoraIso() }) {
  if (!tabelaPresente()) return false;
  const r = db.prepare(`UPDATE entradas_questor_publicacao SET movimento_id=?, atualizado_em=?
    WHERE empresa_id=? AND origem=? AND identidade_outbox=? AND item_numero=?
      AND (movimento_id IS NULL OR movimento_id=?)`)
    .run(Number(movimento_id), agora, Number(empresa_id), origem, String(identidade_outbox), Number(item_numero), Number(movimento_id));
  return r.changes === 1;
}

// PENDENTE/FALHOU elegível → PUBLICANDO, com lease (I3). Devolve o token ou null.
function reservarPublicacao(id, { agora = Date.now() } = {}) {
  const token = crypto.randomUUID();
  const inicio = iso(agora), expira = iso(agora + LEASE_MS);
  const r = db.prepare(`UPDATE entradas_questor_publicacao
    SET estado='PUBLICANDO', tentativas=tentativas+1, publicando_em=?, lease_token=?, lease_expira_em=?, atualizado_em=?
    WHERE id=? AND tentativas < ? AND chave_publicacao IS NOT NULL AND chave_publicacao<>''
      AND (estado='PENDENTE' OR (estado='FALHOU' AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em<=?)))`)
    .run(inicio, token, expira, inicio, Number(id), LIMITE_TENTATIVAS, inicio);
  return r.changes === 1 ? token : null;
}

// Só o detentor do lease grava PUBLICADO (I3). Token antigo não altera nada.
function concluirPublicacao(id, token, { agora = Date.now() } = {}) {
  const a = iso(agora);
  const r = db.prepare(`UPDATE entradas_questor_publicacao
    SET estado='PUBLICADO', publicado_em=?, ultimo_erro=NULL, publicando_em=NULL, proxima_tentativa_em=NULL, lease_token=NULL, lease_expira_em=NULL, atualizado_em=?
    WHERE id=? AND lease_token=? AND estado='PUBLICANDO'`).run(a, a, Number(id), String(token));
  return r.changes === 1;
}

// Falha do detentor do lease. `transitoria` decide se há retry (seção 6).
function falharPublicacao(id, token, erro, { transitoria = true, agora = Date.now() } = {}) {
  const linha = db.prepare("SELECT tentativas FROM entradas_questor_publicacao WHERE id=? AND lease_token=? AND estado='PUBLICANDO'").get(Number(id), String(token));
  if (!linha) return false;
  const a = iso(agora);
  const mensagem = String(erro || 'ERRO').slice(0, 300);
  const definitivo = !transitoria || linha.tentativas >= LIMITE_TENTATIVAS;
  const proxima = definitivo ? null : iso(agora + BACKOFF_MS[linha.tentativas - 1]);
  const r = db.prepare(`UPDATE entradas_questor_publicacao
    SET estado=?, ultimo_erro=?, proxima_tentativa_em=?, publicando_em=NULL, lease_token=NULL, lease_expira_em=NULL, atualizado_em=?
    WHERE id=? AND lease_token=? AND estado='PUBLICANDO'`)
    .run(definitivo ? 'FALHOU_DEFINITIVO' : 'FALHOU', mensagem, proxima, a, Number(id), String(token));
  return r.changes === 1;
}

// Lease expirado → PENDENTE, ou definitivo se estourou tentativas. Devolve detalhe por item (auditoria).
function recuperarLeasesExpirados({ agora = Date.now() } = {}) {
  if (!tabelaPresente()) return [];
  const a = iso(agora);
  return db.transaction(() => {
    const itens = db.prepare(`SELECT id, empresa_id, identidade_outbox, item_numero, estado, tentativas FROM entradas_questor_publicacao
      WHERE estado='PUBLICANDO' AND lease_expira_em < ? LIMIT 500`).all(a);
    if (!itens.length) return [];
    const marcas = itens.map(() => '?').join(',');
    db.prepare(`UPDATE entradas_questor_publicacao
      SET estado=CASE WHEN tentativas>=? THEN 'FALHOU_DEFINITIVO' ELSE 'PENDENTE' END,
          ultimo_erro='LEASE_EXPIRADO', publicando_em=NULL, lease_token=NULL, lease_expira_em=NULL, atualizado_em=?
      WHERE id IN (${marcas})`).run(LIMITE_TENTATIVAS, a, ...itens.map((x) => x.id));
    return itens.map((x) => ({
      id: Number(x.id), empresa_id: Number(x.empresa_id), identidade: String(x.identidade_outbox), item_numero: Number(x.item_numero),
      estado_anterior: x.estado, estado_novo: Number(x.tentativas) >= LIMITE_TENTATIVAS ? 'FALHOU_DEFINITIVO' : 'PENDENTE', data: a,
    }));
  })();
}

// Publicação por identidade composta (I3): `confirmar(identidades)` devolve um Set
// com `chave|item` presentes na fonte. O item é o do movimento publicado.
async function executarPublicacao(empresaId, movimentoIds, publicar, confirmar) {
  if (!tabelaPresente()) return publicar();
  const ids = [...new Set((movimentoIds || []).map(Number).filter(Number.isInteger))];
  const reservados = [];
  if (ids.length) {
    const marcas = ids.map(() => '?').join(',');
    const candidatas = db.prepare(`SELECT e.id, e.chave_publicacao, COALESCE(m.item_numero, 0) AS item_fonte
      FROM entradas_questor_publicacao e JOIN movimentos m ON m.id = e.movimento_id
      WHERE e.empresa_id=? AND e.movimento_id IN (${marcas}) AND e.estado IN ('PENDENTE','FALHOU')`).all(Number(empresaId), ...ids);
    for (const c of candidatas) {
      const token = reservarPublicacao(c.id);
      if (token) reservados.push({ id: c.id, token, chave: String(c.chave_publicacao), item: Number(c.item_fonte) });
    }
  }
  let resultado;
  let erroPublicacao = null;
  try {
    resultado = await publicar();
  } catch (erro) {
    erroPublicacao = erro;
  }
  if (!reservados.length) {
    if (erroPublicacao) throw erroPublicacao;
    return resultado;
  }
  const chaveFonte = (x) => `${x.chave}|${x.item}`;
  let presentes;
  try {
    presentes = await confirmar(reservados.map((x) => ({ chave: x.chave, item_numero: x.item })));
  } catch (erroConfirmacao) {
    for (const item of reservados) falharPublicacao(item.id, item.token, `CONFIRMACAO_FONTE: ${erroConfirmacao.message}`);
    if (erroPublicacao) throw erroPublicacao;
    throw erroConfirmacao;
  }
  for (const item of reservados) {
    if (presentes.has(chaveFonte(item))) concluirPublicacao(item.id, item.token);
    else falharPublicacao(item.id, item.token, erroPublicacao?.message || 'NAO_CONFIRMADO_NA_FONTE');
  }
  const pendentes = reservados.filter((x) => !presentes.has(chaveFonte(x))).length;
  if (erroPublicacao && pendentes === reservados.length) throw erroPublicacao;
  if (resultado && !erroPublicacao) return resultado;
  return { ativo: true, publicados: reservados.length - pendentes, pendentes, erro: erroPublicacao?.message || null };
}

// Worker: recupera leases expirados e publica, por empresa, os elegíveis. O
// agendamento e a flag ficam no servidor; esta função é só a lógica.
async function processarPendentes({ publicarPorEmpresa, agora = Date.now(), limite = 200, auditar = () => {} }) {
  if (!tabelaPresente()) return { sem_tabela: true, recuperados: 0, empresas: [] };
  // Rede de segurança: linha cujo movimento não existe mais é cancelada, nunca retentada.
  const orfas = db.prepare(`UPDATE entradas_questor_publicacao SET estado='CANCELADO', ultimo_erro='MOVIMENTO_AUSENTE', proxima_tentativa_em=NULL, atualizado_em=?
    WHERE estado IN ('PENDENTE','FALHOU','FALHOU_DEFINITIVO') AND movimento_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM movimentos m WHERE m.id = entradas_questor_publicacao.movimento_id)`).run(iso(agora)).changes;
  const recuperados = recuperarLeasesExpirados({ agora });
  if (recuperados.length) auditar({ acao: 'LEASE_EXPIRADO', itens: recuperados });
  const a = iso(agora);
  const candidatos = db.prepare(`SELECT empresa_id, movimento_id FROM entradas_questor_publicacao
    WHERE estado IN ('PENDENTE','FALHOU') AND movimento_id IS NOT NULL AND tentativas < ?
      AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em <= ?)
    ORDER BY empresa_id, id LIMIT ?`).all(LIMITE_TENTATIVAS, a, Math.min(Math.max(Number(limite) || 200, 1), 1000));
  const porEmpresa = new Map();
  for (const c of candidatos) {
    if (!porEmpresa.has(c.empresa_id)) porEmpresa.set(c.empresa_id, []);
    porEmpresa.get(c.empresa_id).push(Number(c.movimento_id));
  }
  const relatorio = [];
  for (const [empresaId, ids] of porEmpresa) {
    try {
      await publicarPorEmpresa(empresaId, ids);
      relatorio.push({ empresa_id: empresaId, itens: ids.length, erro: null });
    } catch (erro) {
      relatorio.push({ empresa_id: empresaId, itens: ids.length, erro: erro.message });
    }
  }
  return { canceladas_orfas: orfas, recuperados: recuperados.length, empresas: relatorio };
}

// Backfill idempotente em lotes com cursor persistido. Para cada movimento
// Questor da empresa, em ordem de id e a partir do cursor:
//   - sem chave publicável → FALHOU_DEFINITIVO (SEM_CHAVE_PUBLICAVEL);
//   - chave presente na fonte (chave + item do movimento) → PUBLICADO;
//   - demais → PENDENTE (o worker ou a próxima publicação envia).
// Cada lote grava seus registros e avança o cursor na MESMA transação; uma
// interrupção antes do commit repete o lote, sem duplicar (chave única) nem pular.
// Identidade só vem de dado estável gravado no próprio lançamento: razao_identificador
// (Razão) ou chave. Sem nenhum dos dois, não há identidade publicável e o caso vai
// para exceção explícita; nunca se inventa `movimento:<id>` (I5).
function classificarMovimentoQuestor(m) {
  let identidade = String(m.chave || '').trim();
  let itemOutbox = Number(m.item_numero || 0);
  if (m.origem === 'QUESTOR_RAZAO') {
    let evidencia = {}; try { evidencia = JSON.parse(m.normalizacao_evidencia || '{}'); } catch (_) { /* tolerante */ }
    identidade = String(evidencia.razao_identificador || '').trim() || identidade;
    itemOutbox = 0;
  }
  const chave = String(m.chave || '').trim();
  return { movimento_id: Number(m.id), origem: m.origem, identidade, item_outbox: itemOutbox, chave, item_fonte: Number(m.item_numero || 0),
    semIdentidade: !identidade, semChave: !chave };
}

async function backfillEntradasQuestor(empresaId, { lote = 100, maxLotes = Infinity, confirmar, agora = agoraIso() } = {}) {
  if (!tabelaPresente()) throw new Error('Migração da outbox ainda não aplicada.');
  const eid = Number(empresaId);
  db.prepare("INSERT OR IGNORE INTO entradas_questor_backfill (empresa_id, ultimo_movimento_id, lotes, atualizado_em) VALUES (?,0,0,?)").run(eid, agora);
  const totais = { lotes: 0, processados: 0, publicados: 0, pendentes: 0, falhas_definitivas: 0, excecoes_sem_identidade: 0, ids_excecao: [], concluido: false };
  const marcas = ORIGENS.map(() => '?').join(',');
  while (totais.lotes < maxLotes) {
    const cursor = db.prepare('SELECT ultimo_movimento_id, concluido_em FROM entradas_questor_backfill WHERE empresa_id=?').get(eid);
    if (cursor.concluido_em) { totais.concluido = true; break; }
    const movimentos = db.prepare(`SELECT id, origem, chave, item_numero, normalizacao_evidencia FROM movimentos
      WHERE empresa_id=? AND origem IN (${marcas}) AND id>? ORDER BY id LIMIT ?`).all(eid, ...ORIGENS, cursor.ultimo_movimento_id, Math.min(Math.max(Number(lote) || 100, 1), 1000));
    if (!movimentos.length) {
      db.prepare('UPDATE entradas_questor_backfill SET concluido_em=?, atualizado_em=? WHERE empresa_id=?').run(agora, agora, eid);
      totais.concluido = true;
      break;
    }
    const linhas = movimentos.map(classificarMovimentoQuestor);
    const excecoes = linhas.filter((x) => x.semIdentidade);
    const registraveis = linhas.filter((x) => !x.semIdentidade);
    const comChave = registraveis.filter((x) => !x.semChave);
    // A consulta à fonte fica fora da transação local; se falhar, nada do lote é gravado.
    const presentes = comChave.length && confirmar
      ? await confirmar(comChave.map((x) => ({ chave: x.chave, item_numero: x.item_fonte })))
      : new Set();
    let publicados = 0, pendentes = 0, falhas = 0;
    db.transaction(() => {
      for (const l of excecoes) totais.ids_excecao.push(l.movimento_id);
      for (const l of registraveis) {
        if (l.semChave) {
          db.prepare(`INSERT INTO entradas_questor_publicacao (empresa_id, movimento_id, origem, identidade_outbox, item_numero, chave_publicacao, estado, tentativas, ultimo_erro, criado_em, atualizado_em)
            VALUES (?,?,?,?,?,NULL,'FALHOU_DEFINITIVO',0,'SEM_CHAVE_PUBLICAVEL',?,?)
            ON CONFLICT (empresa_id, origem, identidade_outbox, item_numero) DO NOTHING`)
            .run(eid, l.movimento_id, l.origem, l.identidade, l.item_outbox, agora, agora);
          falhas += 1;
          continue;
        }
        db.prepare(`INSERT INTO entradas_questor_publicacao (empresa_id, movimento_id, origem, identidade_outbox, item_numero, chave_publicacao, estado, tentativas, criado_em, atualizado_em)
          VALUES (?,?,?,?,?,?,'PENDENTE',0,?,?)
          ON CONFLICT (empresa_id, origem, identidade_outbox, item_numero) DO NOTHING`)
          .run(eid, l.movimento_id, l.origem, l.identidade, l.item_outbox, l.chave, agora, agora);
        if (presentes.has(`${l.chave}|${l.item_fonte}`)) {
          db.prepare(`UPDATE entradas_questor_publicacao SET estado='PUBLICADO', publicado_em=?, ultimo_erro=NULL, movimento_id=COALESCE(movimento_id, ?), atualizado_em=?
            WHERE empresa_id=? AND origem=? AND identidade_outbox=? AND item_numero=? AND estado NOT IN ('PUBLICADO','PUBLICANDO')`)
            .run(agora, l.movimento_id, agora, eid, l.origem, l.identidade, l.item_outbox);
          publicados += 1;
        } else {
          pendentes += 1;
        }
      }
      db.prepare('UPDATE entradas_questor_backfill SET ultimo_movimento_id=?, lotes=lotes+1, atualizado_em=? WHERE empresa_id=?')
        .run(movimentos[movimentos.length - 1].id, agora, eid);
    })();
    totais.lotes += 1; totais.processados += linhas.length; totais.excecoes_sem_identidade += excecoes.length;
    totais.publicados += publicados; totais.pendentes += pendentes; totais.falhas_definitivas += falhas;
  }
  return totais;
}

// Contagem por estado e página de pendências. Leituras internas: não dependem da flag.
function resumoPendencias(empresaId) {
  if (!tabelaPresente()) return {};
  const linhas = db.prepare(`SELECT estado, COUNT(*) AS quantidade FROM entradas_questor_publicacao
    WHERE empresa_id=? AND estado NOT IN ('PUBLICADO','CANCELADO') GROUP BY estado`).all(Number(empresaId));
  return Object.fromEntries(linhas.map((x) => [x.estado, Number(x.quantidade)]));
}
function contarPendencias(empresaId) {
  if (!tabelaPresente()) return 0;
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM entradas_questor_publicacao
    WHERE empresa_id=? AND estado NOT IN ('PUBLICADO','CANCELADO')`).get(Number(empresaId)).n);
}
function listarPendencias(empresaId, { pagina = 1, limite = 50 } = {}) {
  if (!tabelaPresente()) return [];
  const l = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const p = Math.max(1, Number(pagina) || 1);
  return db.prepare(`SELECT id, origem, identidade_outbox, item_numero, estado, tentativas, ultimo_erro, proxima_tentativa_em, atualizado_em
    FROM entradas_questor_publicacao WHERE empresa_id=? AND estado NOT IN ('PUBLICADO','CANCELADO')
    ORDER BY atualizado_em DESC, id DESC LIMIT ? OFFSET ?`).all(Number(empresaId), l, (p - 1) * l);
}

module.exports = { ativa, tabelaPresente, LIMITE_TENTATIVAS, BACKOFF_MS, registrarPendente, materializarPrevia, reservarPublicacao, concluirPublicacao, falharPublicacao, recuperarLeasesExpirados, executarPublicacao, processarPendentes, backfillEntradasQuestor, classificarMovimentoQuestor, resumoPendencias, contarPendencias, listarPendencias };

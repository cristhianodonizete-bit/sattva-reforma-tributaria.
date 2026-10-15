const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-outbox-'));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://teste.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'teste';
process.env.ENTRADAS_OUTBOX_ATIVA = 'false';
const db = require('../src/db');
const o = require('../src/services/entradasQuestorOutbox');
const migracao = require('../src/services/entradasQuestorMigracao');

const MIN = 60_000;
const T0 = Date.parse('2026-10-14T12:00:00Z');
const iso = (t) => new Date(t).toISOString();
const existeTabela = (nome) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(nome);
const existeIndice = (nome) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(nome);
const empresa = Number(db.prepare('INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)').run('00000000000194', 'Outbox').lastInsertRowid);
const linha = (id) => db.prepare('SELECT * FROM entradas_questor_publicacao WHERE id=?').get(id);
const todas = async (ids) => new Set(ids.map((x) => `${x.chave}|${x.item_numero}`));
const movimento = (emp, chave, item = 1, origem = 'QUESTOR_CONCILIACAO_ENTRADA', evidencia = null) => Number(db.prepare(
  'INSERT INTO movimentos (empresa_id,tipo,sentido,competencia,valor,origem,descricao,chave,item_numero,normalizacao_evidencia) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(emp, 'fornecedor', 'fornecedor', '2026-01', 10, origem, 'teste', chave, item, evidencia).lastInsertRowid);
const pendente = (ident, item, chave = ident) => {
  const mov = movimento(empresa, chave, item);
  o.registrarPendente({ empresa_id: empresa, movimento_id: mov, origem: 'QUESTOR_CONCILIACAO_ENTRADA', identidade_outbox: ident, item_numero: item, chave_publicacao: chave, agora: iso(T0) });
  return Number(db.prepare('SELECT id FROM entradas_questor_publicacao WHERE empresa_id=? AND identidade_outbox=? AND item_numero=?').get(empresa, ident, item).id);
};

(async () => {
  // 1. Antes da migração: nada é criado, nenhuma escrita quebra o fluxo.
  assert.equal(o.tabelaPresente(), false);
  assert.equal(o.registrarPendente({ empresa_id: empresa, origem: 'QUESTOR_RAZAO', identidade_outbox: 'X', chave_publicacao: 'X' }), false);
  assert.deepEqual(o.resumoPendencias(empresa), {});
  assert.equal(await o.executarPublicacao(empresa, [1], async () => 'direto', async () => { throw new Error('não confirma sem tabela'); }), 'direto');
  await assert.rejects(o.backfillEntradasQuestor(empresa, { confirmar: todas }), /Migração da outbox/);

  // 2. Migração atômica: falha no meio reverte tudo; sucesso cria tabelas e índice.
  const sqlBom = migracao.lerSql();
  assert.throws(() => migracao.aplicarMigracao(sqlBom + '\nCREATE TABLE tabela_invalida (;'));
  assert.equal(existeTabela('entradas_questor_publicacao'), false, 'rollback não deixou a outbox');
  assert.equal(existeTabela('entradas_questor_backfill'), false, 'rollback não deixou o cursor');
  migracao.aplicarMigracao();
  assert.equal(existeTabela('entradas_questor_publicacao'), true);
  assert.equal(existeTabela('entradas_questor_backfill'), true);
  assert.equal(existeIndice('idx_entradas_questor_publicacao_fila'), true);
  migracao.aplicarMigracao(); // repetir não quebra (IF NOT EXISTS)
  assert.equal(o.tabelaPresente(), true);

  // 3. Flag desligada: o novo lançamento AINDA entra na outbox, na mesma transação.
  assert.equal(o.ativa(), false);
  const idSemFlag = db.transaction(() => {
    const mov = movimento(empresa, 'CHAVE-SEM-FLAG', 1);
    o.registrarPendente({ empresa_id: empresa, movimento_id: mov, origem: 'QUESTOR_CONCILIACAO_ENTRADA', identidade_outbox: 'CHAVE-SEM-FLAG', item_numero: 1, chave_publicacao: 'CHAVE-SEM-FLAG', agora: iso(T0) });
    return Number(db.prepare("SELECT id FROM entradas_questor_publicacao WHERE identidade_outbox='CHAVE-SEM-FLAG'").get().id);
  })();
  assert.equal(linha(idSemFlag).estado, 'PENDENTE');
  // Falha da transação do movimento não deixa linha órfã (I6).
  assert.throws(() => db.transaction(() => {
    o.registrarPendente({ empresa_id: empresa, origem: 'QUESTOR_RAZAO', identidade_outbox: 'RAZ-ATOMICO', chave_publicacao: 'RAZ-ATOMICO', agora: iso(T0) });
    throw new Error('falha após gravar');
  })(), /falha após gravar/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entradas_questor_publicacao WHERE identidade_outbox='RAZ-ATOMICO'").get().c, 0);

  // 4. Ciclo de vida (com a tabela e com a flag desligada: escrita e leitura interna seguem).
  o.registrarPendente({ empresa_id: empresa, origem: 'QUESTOR_RAZAO', identidade_outbox: 'RAZ-SEM-CHAVE', chave_publicacao: null, agora: iso(T0) });
  const semChave = db.prepare("SELECT * FROM entradas_questor_publicacao WHERE identidade_outbox='RAZ-SEM-CHAVE'").get();
  assert.equal(semChave.estado, 'FALHOU_DEFINITIVO'); assert.equal(semChave.ultimo_erro, 'SEM_CHAVE_PUBLICAVEL');

  const idA = pendente('CHAVE-A', 1);
  assert.equal(o.registrarPendente({ empresa_id: empresa, origem: 'QUESTOR_CONCILIACAO_ENTRADA', identidade_outbox: 'CHAVE-A', item_numero: 1, chave_publicacao: 'CHAVE-A' }), false);
  const tokenA = o.reservarPublicacao(idA, { agora: T0 });
  assert.equal(o.concluirPublicacao(idA, 'token-antigo', { agora: T0 }), false);
  assert.equal(o.concluirPublicacao(idA, tokenA, { agora: T0 + 1000 }), true);
  assert.equal(linha(idA).estado, 'PUBLICADO');
  assert.equal(o.concluirPublicacao(idA, tokenA, { agora: T0 + 2000 }), false);

  const idB = pendente('CHAVE-B', 1);
  const esperas = [1, 5, 30, 120];
  let agora = T0;
  for (let t = 1; t <= 5; t += 1) {
    const token = o.reservarPublicacao(idB, { agora });
    assert.ok(token, `tentativa ${t}`);
    o.falharPublicacao(idB, token, 'timeout', { transitoria: true, agora });
    if (t < 5) {
      assert.equal(linha(idB).estado, 'FALHOU');
      assert.equal(Date.parse(linha(idB).proxima_tentativa_em) - agora, esperas[t - 1] * MIN);
      agora = Date.parse(linha(idB).proxima_tentativa_em);
    } else assert.equal(linha(idB).estado, 'FALHOU_DEFINITIVO');
  }

  const idD = pendente('CHAVE-D', 1);
  const tokenD = o.reservarPublicacao(idD, { agora: T0 });
  assert.equal(o.recuperarLeasesExpirados({ agora: T0 + MIN }).length, 0);
  const recuperados = o.recuperarLeasesExpirados({ agora: T0 + 6 * MIN });
  assert.deepEqual(recuperados[0], { id: idD, empresa_id: empresa, identidade: 'CHAVE-D', item_numero: 1, estado_anterior: 'PUBLICANDO', estado_novo: 'PENDENTE', data: iso(T0 + 6 * MIN) });
  assert.equal(o.concluirPublicacao(idD, tokenD, { agora: T0 + 7 * MIN }), false);

  // Identidade composta: mesma chave, outro item na fonte, não confirma o item local.
  const idMC = pendente('CHAVE-M', 1);
  let pedidos = null;
  await o.executarPublicacao(empresa, [linha(idMC).movimento_id], async () => ({ ativo: true, pendentes: 1 }), async (ids) => { pedidos = ids; return new Set(['CHAVE-M|2']); });
  assert.deepEqual(pedidos, [{ chave: 'CHAVE-M', item_numero: 1 }]);
  assert.equal(linha(idMC).estado, 'FALHOU');

  // Razão: outbox com item 0; a confirmação usa o item do movimento (1).
  o.registrarPendente({ empresa_id: empresa, origem: 'QUESTOR_RAZAO', identidade_outbox: 'RAZ-ITEM', item_numero: 0, chave_publicacao: 'QUESTOR_RAZAO:abc', agora: iso(T0) });
  const idRazao = Number(db.prepare("SELECT id FROM entradas_questor_publicacao WHERE identidade_outbox='RAZ-ITEM'").get().id);
  const movRazao = movimento(empresa, 'QUESTOR_RAZAO:abc', 1, 'QUESTOR_RAZAO');
  db.prepare('UPDATE entradas_questor_publicacao SET movimento_id=? WHERE id=?').run(movRazao, idRazao);
  let itensRazao = null;
  await o.executarPublicacao(empresa, [movRazao], async () => ({ ativo: true, pendentes: 0 }), async (ids) => { itensRazao = ids; return todas(ids); });
  assert.deepEqual(itensRazao, [{ chave: 'QUESTOR_RAZAO:abc', item_numero: 1 }]);
  assert.equal(linha(idRazao).estado, 'PUBLICADO');

  // Erro depois da gravação: confirmado na fonte, publicado, sem pendentes.
  const pG = pendente('GRAVADO-ERRO', 1);
  const retorno = await o.executarPublicacao(empresa, [linha(pG).movimento_id], async () => { throw new Error('resposta perdida'); }, todas);
  assert.equal(linha(pG).estado, 'PUBLICADO'); assert.equal(retorno.pendentes, 0);

  // Auditoria do worker recebe detalhe por item.
  const pL = pendente('LEASE-AUD', 1);
  o.reservarPublicacao(pL, { agora: T0 });
  let evento = null;
  await o.processarPendentes({ agora: T0 + 6 * MIN, publicarPorEmpresa: async () => {}, auditar: (e) => { evento = e; } });
  assert.equal(evento.itens.find((i) => i.id === pL).identidade, 'LEASE-AUD');
  assert.equal(evento.itens.find((i) => i.id === pL).empresa_id, empresa);

  // 5. Backfill: empresa separada, lotes de 2, interrompido e retomado.
  const empresa2 = Number(db.prepare('INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)').run('00000000000195', 'Backfill').lastInsertRowid);
  const fonte = new Set(['BF-1|1', 'QUESTOR_RAZAO:bf3|1']);
  const confirmarFonte = async (ids) => new Set(ids.map((x) => `${x.chave}|${x.item_numero}`).filter((k) => fonte.has(k)));
  const m1 = movimento(empresa2, 'BF-1', 1);                       // PUBLICADO
  const m2 = movimento(empresa2, 'BF-2', 1);                       // PENDENTE
  const m3 = movimento(empresa2, 'QUESTOR_RAZAO:bf3', 1, 'QUESTOR_RAZAO', JSON.stringify({ razao_identificador: 'RAZ-BF-3' })); // PUBLICADO, item 0
  const m4 = movimento(empresa2, '', 1);                           // sem identidade: exceção, sem linha
  const m7 = movimento(empresa2, '', 1, 'QUESTOR_RAZAO', JSON.stringify({ razao_identificador: 'RAZ-SEM-CH' })); // FALHOU_DEFINITIVO
  const m5 = movimento(empresa2, 'BF-5', 2);                       // PENDENTE: fonte tem só BF-5|1
  const m6 = movimento(empresa2, 'BF-1', 9, 'QUESTOR_CONCILIACAO_ENTRADA'); // mesma chave, outro item → PENDENTE
  // Movimento de outra origem não entra no backfill.
  movimento(empresa2, 'MANUAL-X', 1, 'MANUAL_ENTRADA');

  const parcial = await o.backfillEntradasQuestor(empresa2, { lote: 2, maxLotes: 1, confirmar: confirmarFonte, agora: iso(T0) });
  assert.equal(parcial.lotes, 1); assert.equal(parcial.concluido, false);
  assert.equal(db.prepare('SELECT ultimo_movimento_id u FROM entradas_questor_backfill WHERE empresa_id=?').get(empresa2).u, m2);
  const retomado = await o.backfillEntradasQuestor(empresa2, { lote: 2, confirmar: confirmarFonte, agora: iso(T0) });
  assert.equal(retomado.concluido, true);
  const estados = Object.fromEntries(db.prepare("SELECT identidade_outbox||'#'||item_numero k, estado e FROM entradas_questor_publicacao WHERE empresa_id=?").all(empresa2).map((x) => [x.k, x.e]));
  assert.equal(estados['BF-1#1'], 'PUBLICADO', 'PUBLICADO');
  assert.equal(estados['BF-2#1'], 'PENDENTE', 'PENDENTE');
  assert.equal(estados['RAZ-BF-3#0'], 'PUBLICADO', 'Razão com item 0');
  assert.equal(estados['RAZ-SEM-CH#0'], 'FALHOU_DEFINITIVO', 'Razão com identidade e sem chave');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM entradas_questor_publicacao WHERE movimento_id=?').get(m4).c, 0, 'sem identidade não cria linha');
  assert.ok(retomado.ids_excecao.includes(m4), 'exceção registrada');
  assert.equal(retomado.excecoes_sem_identidade, 1);
  assert.equal(estados['BF-5#2'], 'PENDENTE', 'item diferente na fonte não publica');
  assert.equal(estados['BF-1#9'], 'PENDENTE', 'mesma chave, item diferente, pendente');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entradas_questor_publicacao WHERE empresa_id=?").get(empresa2).c, 6, 'sem duplicar nem pular');
  assert.equal(db.prepare("SELECT ultimo_erro e FROM entradas_questor_publicacao WHERE empresa_id=? AND movimento_id=?").get(empresa2, m7).e, 'SEM_CHAVE_PUBLICAVEL');
  // Repetir o backfill concluído não muda nada.
  const repetido = await o.backfillEntradasQuestor(empresa2, { lote: 2, confirmar: confirmarFonte, agora: iso(T0) });
  assert.equal(repetido.processados, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entradas_questor_publicacao WHERE empresa_id=?").get(empresa2).c, 6);

  // Gatilhos: exclusão e cancelamento locais cancelam a outbox na mesma transação.
  const idPend = Number(db.prepare("SELECT id FROM entradas_questor_publicacao WHERE empresa_id=? AND movimento_id=?").get(empresa2, m2).id);
  db.prepare('DELETE FROM movimentos WHERE id=?').run(m2);
  assert.equal(linha(idPend).estado, 'CANCELADO'); assert.equal(linha(idPend).ultimo_erro, 'MOVIMENTO_EXCLUIDO');
  assert.equal(o.reservarPublicacao(idPend, { agora: T0 }), null);
  const idCanc = Number(db.prepare("SELECT id FROM entradas_questor_publicacao WHERE empresa_id=? AND movimento_id=?").get(empresa2, m6).id);
  db.prepare("UPDATE movimentos SET situacao_documento='CANCELADO' WHERE id=?").run(m6);
  assert.equal(linha(idCanc).estado, 'CANCELADO'); assert.equal(linha(idCanc).ultimo_erro, 'MOVIMENTO_CANCELADO');
  const idPub = Number(db.prepare("SELECT id FROM entradas_questor_publicacao WHERE empresa_id=? AND movimento_id=?").get(empresa2, m1).id);
  db.prepare('DELETE FROM movimentos WHERE id=?').run(m1);
  assert.equal(linha(idPub).estado, 'PUBLICADO', 'item já publicado não é alterado localmente');
  // Rede de segurança: linha órfã é cancelada pelo worker, nunca retentada.
  o.registrarPendente({ empresa_id: empresa2, movimento_id: 999999, origem: 'QUESTOR_CONCILIACAO_ENTRADA', identidade_outbox: 'ORFA', item_numero: 1, chave_publicacao: 'ORFA', agora: iso(T0) });
  const idOrfa = Number(db.prepare("SELECT id FROM entradas_questor_publicacao WHERE identidade_outbox='ORFA'").get().id);
  await o.processarPendentes({ agora: T0, publicarPorEmpresa: async () => { throw new Error('não deve publicar órfã'); } });
  assert.equal(linha(idOrfa).estado, 'CANCELADO'); assert.equal(linha(idOrfa).ultimo_erro, 'MOVIMENTO_AUSENTE');

  // Fonte indisponível no meio: o lote não é gravado e o cursor não avança.
  const empresa3 = Number(db.prepare('INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)').run('00000000000196', 'Backfill falha').lastInsertRowid);
  movimento(empresa3, 'FALHA-1', 1);
  await assert.rejects(o.backfillEntradasQuestor(empresa3, { lote: 10, confirmar: async () => { throw new Error('fonte fora'); } }), /fonte fora/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entradas_questor_publicacao WHERE empresa_id=?").get(empresa3).c, 0);
  assert.equal(db.prepare('SELECT ultimo_movimento_id u FROM entradas_questor_backfill WHERE empresa_id=?').get(empresa3).u, 0);

  // 6. Rota: visual controlado pela flag; a escrita não depende dela.
  const router = require('../src/routes/api');
  const app = express(); app.use(router);
  const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const get = async () => (await fetch(`http://127.0.0.1:${servidor.address().port}/empresas/${empresa}/entradas-questor/pendencias?limite=2&pagina=1`)).json();
  try {
    process.env.ENTRADAS_OUTBOX_ATIVA = 'false';
    const desligada = await get();
    assert.equal(desligada.desativado, true); assert.equal(desligada.total, 0); assert.deepEqual(desligada.itens, []);
    process.env.ENTRADAS_OUTBOX_ATIVA = 'true';
    const ligada = await get();
    assert.equal(ligada.desativado, undefined);
    assert.equal(ligada.total, o.contarPendencias(empresa));
    assert.ok(ligada.itens.length <= 2);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }

  console.log('ok entradas-questor-outbox');
})().catch((e) => { console.error(e); process.exit(1); });

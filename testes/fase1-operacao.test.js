#!/usr/bin/env node
/*
 * Fechamento Fase 1 — prova em banco isolado de que o motor materializado
 * identifica dependências, reprocessa somente o necessário e a fila persiste
 * o estado fora da memória do worker.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = path.join(os.tmpdir(), `sattva-fase1-${process.pid}-${Date.now()}`);
process.env.SATTVA_DADOS = dir;
// Este teste prova o comportamento da fila local espelhada. A tabela e as
// funções equivalentes do Supabase são verificadas pela migração e pela
// inicialização em produção; não criamos jobs artificiais na base do cliente.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = require('../src/db');
const motorExec = require('../src/services/motorExec');
const fila = require('../src/services/processamentoCarteira');
const regras = require('../src/services/regras');

const fonteRelatorio = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'relatorio.js'), 'utf8');
assert.equal(/motorExec\.executar\s*\(/.test(fonteRelatorio), false,
  'relatório técnico não pode recalcular a situação-base por motor paralelo');
assert.equal(/function motorPersistido\(/.test(fonteRelatorio), true,
  'relatório técnico deve adaptar a fotografia já materializada');

function esperar(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  try {
    const empresaId = Number(db.prepare(`INSERT INTO empresas (cnpj,razao_social,regime,regime_resolvido)
      VALUES ('99000000000001','Fixture incremental','lucro_real','lucro_real')`).run().lastInsertRowid);
    db.prepare(`INSERT INTO parceiros (empresa_id,tipo,cnpj,descricao,regime,perfil_economico)
      VALUES (?, 'fornecedor', '88000000000001', 'Fornecedor regular', 'lucro_real', 'indeterminado')`)
      .run(empresaId);
    db.prepare(`INSERT INTO parceiros (empresa_id,tipo,cnpj,descricao,regime,perfil_economico)
      VALUES (?, 'fornecedor', '88000000000002', 'Fornecedor Simples', 'simples_nacional', 'indeterminado')`)
      .run(empresaId);
    const inserirMovimento = db.prepare(`INSERT INTO movimentos
      (empresa_id,tipo,nome,inscr_federal,descricao,ncm,valor,base_calculo,competencia,reducao)
      VALUES (?, 'fornecedor', ?, ?, 'Mercadoria fixture', '01012100', 1000, 1000, '2027-01', 'integral')`);
    const movimentos = [];
    for (let i = 0; i < 100; i++) {
      const simples = i >= 90;
      movimentos.push(Number(inserirMovimento.run(empresaId, simples ? 'Fornecedor Simples' : 'Fornecedor regular', simples ? '88000000000002' : '88000000000001').lastInsertRowid));
    }
    const movimentoId = movimentos[0];
    const movimentosSimples = movimentos.slice(90);

    motorExec.executar(empresaId, { ano: 2027 });
    assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [], 'fotografia recém-gravada não pode ficar pendente');

    // De 100 operações, alterar uma delas só pode recalcular aquela linha.
    db.prepare('UPDATE movimentos SET valor=1001 WHERE id=?').run(movimentoId);
    assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [movimentoId], 'mudança pontual não pode refazer a empresa inteira');
    let r = motorExec.reprocessarIncremental(empresaId, { ano: 2027 });
    assert.equal(r.reprocessados, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM motor_resultados WHERE empresa_id=?').get(empresaId).c, 100);

    // A premissa CBS do Simples afeta somente as dez operações desse regime.
    const antes = db.prepare("SELECT credito_cbs_simples_referencia FROM param_regimes WHERE chave='simples_nacional'").get();
    db.prepare("UPDATE param_regimes SET credito_cbs_simples_referencia=? WHERE chave='simples_nacional'").run((Number(antes.credito_cbs_simples_referencia) || 0) + 0.001);
    regras.invalidar();
    assert.deepEqual(motorExec.pendentesIncrementais(empresaId).sort((a, b) => a - b), movimentosSimples, 'parâmetro do Simples só deve invalidar dependentes do Simples');
    r = motorExec.reprocessarIncremental(empresaId, { ano: 2027 });
    assert.equal(r.reprocessados, 10);

    // Dependência do parceiro: sem alterar movimentos, a troca de cadastro
    // seleciona apenas os dez registros ligados àquela contraparte.
    db.prepare("UPDATE parceiros SET regime='mei' WHERE empresa_id=? AND cnpj='88000000000002'").run(empresaId);
    assert.deepEqual(motorExec.pendentesIncrementais(empresaId).sort((a, b) => a - b), movimentosSimples, 'mudança de parceiro deve invalidar apenas operações vinculadas');
    r = motorExec.reprocessarIncremental(empresaId, { ano: 2027 });
    assert.equal(r.reprocessados, 10);

    // Dependência derivada do catálogo/classificação também faz parte do hash.
    db.prepare("UPDATE movimentos SET reducao='reduzida', cclasstrib='000001', classificacao_origem='fixture' WHERE id=?").run(movimentoId);
    assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [movimentoId], 'reclassificação deve invalidar a operação afetada');
    r = motorExec.reprocessarIncremental(empresaId, { ano: 2027 });
    assert.equal(r.reprocessados, 1);

    // Remoção não pode deixar resultado órfão na fotografia oficial.
    db.prepare('DELETE FROM movimentos WHERE id=?').run(movimentoId);
    r = motorExec.reprocessarIncremental(empresaId, { ano: 2027 });
    assert.equal(r.removidos, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM motor_resultados WHERE empresa_id=?').get(empresaId).c, 99);

    // A fila escreve estado em tabela e pode ser retomada por executar(), em
    // vez de depender de setImmediate ou de memória do processo.
    const proc = await fila.iniciar({ empresas: [empresaId], competencia: 2027 });
    for (let i = 0; i < 20; i++) {
      const atual = fila.consultar(proc.id);
      if (atual.jobs.every((j) => ['CONCLUIDO', 'FALHOU'].includes(j.status))) break;
      await esperar(25);
    }
    const final = fila.consultar(proc.id);
    assert.equal(final.jobs.length, 1, 'job deve ficar persistido');
    assert.equal(final.jobs[0].status, 'CONCLUIDO', 'worker deve concluir job recuperável');
    assert.equal(final.itens[0].status === 'AUTOMATICA' || final.itens[0].status === 'COM_EXCECOES', true);

    const inserirJob = db.prepare(`INSERT INTO jobs_carteira
      (id,processamento_id,empresa_id,competencia,tipo_job,status,tentativas,max_tentativas,heartbeat,criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    // Reinício: um heartbeat vencido devolve o job à fila sem perder o id.
    inserirJob.run('job-abandonado', proc.id, empresaId, '2027-02', 'TESTE_REINICIO', 'PROCESSANDO', 1, 3, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
    await fila.recuperarAbandonados();
    assert.equal(db.prepare('SELECT status FROM jobs_carteira WHERE id=?').get('job-abandonado').status, 'PENDENTE', 'job abandonado deve ser retomável após reinício');

    // Claim concorrente: exatamente um worker recebe o mesmo job.
    const [claimA, claimB] = await Promise.all([fila.claim(), fila.claim()]);
    assert.equal([claimA, claimB].filter(Boolean).length, 1, 'claim não pode entregar o mesmo job a dois workers');
    assert.equal((claimA || claimB).id, 'job-abandonado');

    // Retry com espera: job futuro não é selecionado antes do horário.
    inserirJob.run('job-retry', proc.id, empresaId, '2027-03', 'TESTE_RETRY', 'PENDENTE', 1, 3, null, new Date().toISOString());
    db.prepare("UPDATE jobs_carteira SET proxima_tentativa_em='2999-01-01T00:00:00.000Z' WHERE id='job-retry'").run();
    assert.equal(await fila.claim(), null, 'retry com espera não pode entrar em loop imediato');

    // Cancelamento preserva o histórico e impede execução posterior.
    inserirJob.run('job-cancelar', proc.id, empresaId, '2027-04', 'TESTE_CANCELAR', 'PENDENTE', 0, 3, null, new Date().toISOString());
    assert.equal((await fila.cancelar('job-cancelar')).cancelado, true);
    assert.equal(db.prepare('SELECT status FROM jobs_carteira WHERE id=?').get('job-cancelar').status, 'CANCELADO');

    // A mesma chave lógica ativa é reaproveitada, não duplicada.
    inserirJob.run('job-duplicado', proc.id, empresaId, '2027-05', 'TESTE_DUPLICADO', 'PENDENTE', 0, 3, null, new Date().toISOString());
    const duplicado = await fila.iniciar({ empresas: [empresaId], competencia: '2027-05', tipo: 'TESTE_DUPLICADO' });
    assert.equal(duplicado.deduplicado, true, 'job lógico duplicado deve reutilizar o job ativo');
    console.log('fase1-operacao.test: incremental, exclusão e fila persistida aprovados.');
  } finally {
    try { db.close?.(); } catch (_) { /* SQLite pode já estar encerrado */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });

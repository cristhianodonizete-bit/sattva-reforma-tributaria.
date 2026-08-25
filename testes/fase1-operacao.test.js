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
      VALUES (?, 'fornecedor', '88000000000001', 'Fornecedor fixture', 'lucro_real', 'indeterminado')`)
      .run(empresaId);
    const movimentoId = Number(db.prepare(`INSERT INTO movimentos
      (empresa_id,tipo,nome,inscr_federal,descricao,ncm,valor,base_calculo,competencia,reducao)
      VALUES (?, 'fornecedor', 'Fornecedor fixture', '88000000000001', 'Mercadoria fixture', '01012100', 1000, 1000, '2027-01', 'integral')`)
      .run(empresaId).lastInsertRowid);

    motorExec.executar(empresaId, { ano: 2027 });
    assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [], 'fotografia recém-gravada não pode ficar pendente');

    // Dependência do parceiro: sem alterar o movimento, a troca de regime deve
    // selecionar somente sua operação para recálculo.
    db.prepare("UPDATE parceiros SET regime='simples_nacional' WHERE empresa_id=? AND cnpj='88000000000001'").run(empresaId);
    assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [movimentoId], 'mudança no parceiro deve invalidar a operação vinculada');
    let r = motorExec.reprocessarIncremental(empresaId, { ano: 2027 });
    assert.equal(r.reprocessados, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM motor_resultados WHERE empresa_id=?').get(empresaId).c, 1);

    // Dependência derivada do catálogo/classificação também faz parte do hash.
    db.prepare("UPDATE movimentos SET reducao='reduzida', cclasstrib='000001', classificacao_origem='fixture' WHERE id=?").run(movimentoId);
    assert.deepEqual(motorExec.pendentesIncrementais(empresaId), [movimentoId], 'reclassificação deve invalidar a operação afetada');
    r = motorExec.reprocessarIncremental(empresaId, { ano: 2027 });
    assert.equal(r.reprocessados, 1);

    // Remoção não pode deixar resultado órfão na fotografia oficial.
    db.prepare('DELETE FROM movimentos WHERE id=?').run(movimentoId);
    r = motorExec.reprocessarIncremental(empresaId, { ano: 2027 });
    assert.equal(r.removidos, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM motor_resultados WHERE empresa_id=?').get(empresaId).c, 0);

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
    console.log('fase1-operacao.test: incremental, exclusão e fila persistida aprovados.');
  } finally {
    try { db.close?.(); } catch (_) { /* SQLite pode já estar encerrado */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });

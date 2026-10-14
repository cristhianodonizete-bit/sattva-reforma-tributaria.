#!/usr/bin/env node
/* Prova de convergência: cadastro canônico vence fotografia incompatível. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = path.join(os.tmpdir(), `sattva-projecoes-${process.pid}-${Date.now()}`);
process.env.SATTVA_DADOS = dir;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = require('../src/db');
const motorExec = require('../src/services/motorExec');
const projecoes = require('../src/services/projecoesMovimentos');
const consolidacao = require('../src/services/consolidacaoOficial');
const perfilCbs = require('../src/services/perfilCbs');

try {
  const empresaId = Number(db.prepare(`INSERT INTO empresas(cnpj,razao_social,regime,regime_resolvido)
    VALUES ('99111111000101','Empresa de prova','lucro_real','lucro_real')`).run().lastInsertRowid);
  const parceiroId = Number(db.prepare(`INSERT INTO parceiros
    (empresa_id,tipo,cnpj,descricao,regime,regime_origem,regime_versao)
    VALUES (?,'fornecedor','88111111000101','Fornecedor prova','lucro_real','CADASTRO_TESTE',1)`).run(empresaId).lastInsertRowid);
  const movimentoId = Number(db.prepare(`INSERT INTO movimentos
    (empresa_id,tipo,nome,inscr_federal,descricao,ncm,valor,base_calculo,competencia,reducao,regime,regime_fonte,regime_parceiro_versao)
    VALUES (?,'fornecedor','Fornecedor prova','88111111000101','Mercadoria de prova','01012100',1000,1000,'2027-01','integral','lucro_real','PARCEIRO_CANONICO',1)`).run(empresaId).lastInsertRowid);

  motorExec.executar(empresaId,{ ano:2027,movimentoIds:[movimentoId] });
  let estados = projecoes.reconciliar(db,empresaId,[movimentoId]);
  assert.equal(estados.get(movimentoId).situacao,projecoes.ESTADOS.ATUAL,'resultado recém-calculado deve ser vigente');

  // A decisão muda primeiro na fonte canônica. Antes de worker algum rodar,
  // toda consulta analítica deve rejeitar a fotografia anterior.
  db.prepare("UPDATE parceiros SET regime='lucro_presumido',regime_versao=2,regime_origem='CONFIRMACAO_TESTE' WHERE id=?").run(parceiroId);
  db.prepare("UPDATE movimentos SET regime='lucro_presumido',regime_fonte='PARCEIRO_CANONICO',regime_parceiro_versao=2 WHERE id=?").run(movimentoId);
  projecoes.marcar(db,empresaId,[movimentoId],projecoes.ESTADOS.PENDENTE,'Teste de alteração canônica','job-fixture');
  consolidacao.invalidarCacheEmpresa(empresaId);
  let leitura = consolidacao.listar(empresaId,{ limite:100 }).itens.find((x)=>Number(x.movimento_id)===movimentoId);
  assert.equal(leitura.resultado_vigente,false,'fotografia divergente não pode ser usada como atual');
  assert.equal(leitura.situacao_projecao,projecoes.ESTADOS.PENDENTE);
  assert.equal(leitura.regime_parceiro,'lucro_presumido','a decisão canônica deve aparecer imediatamente');
  assert.equal(leitura.cbs,null,'valor financeiro vencido não pode alimentar a tela');
  assert.equal(perfilCbs.materializar(empresaId,{ movimentoIds:[movimentoId] }).competencias.length,0,'perfil CBS não pode materializar fotografia vencida');

  // Falha do worker mantém a decisão, troca somente o estado operacional.
  projecoes.marcar(db,empresaId,[movimentoId],projecoes.ESTADOS.FALHOU,'Falha simulada do worker','job-fixture');
  consolidacao.invalidarCacheEmpresa(empresaId);
  leitura = consolidacao.listar(empresaId,{ limite:100 }).itens.find((x)=>Number(x.movimento_id)===movimentoId);
  assert.equal(leitura.situacao_projecao,projecoes.ESTADOS.FALHOU);
  assert.equal(leitura.regime_parceiro,'lucro_presumido');

  // Reprocessar somente o delta reconcilia a assinatura e libera a linha.
  const reprocessado = motorExec.reprocessarIncremental(empresaId,{ ano:2027,movimentoIds:[movimentoId] });
  assert.equal(reprocessado.reprocessados,1);
  estados = projecoes.reconciliar(db,empresaId,[movimentoId]);
  assert.equal(estados.get(movimentoId).situacao,projecoes.ESTADOS.ATUAL);
  consolidacao.invalidarCacheEmpresa(empresaId);
  leitura = consolidacao.listar(empresaId,{ limite:100 }).itens.find((x)=>Number(x.movimento_id)===movimentoId);
  assert.equal(leitura.resultado_vigente,true);
  assert.equal(leitura.resultado_vigente,true,'a nova fotografia é a única fonte financeira vigente');
  assert.equal(perfilCbs.materializar(empresaId,{ movimentoIds:[movimentoId] }).competencias.length,1,'perfil CBS volta a materializar somente após a projeção ficar atual');

  const saidaId = Number(db.prepare(`INSERT INTO movimentos
    (empresa_id,tipo,sentido,nome,inscr_federal,descricao,valor,competencia,reducao,regime)
    VALUES (?,'cliente','saida','Cliente prova','77111111000101','Venda de prova',500,'2027-01','integral','lucro_real')`).run(empresaId).lastInsertRowid);
  estados = projecoes.reconciliar(db,empresaId,[saidaId]);
  assert.equal(estados.get(saidaId).situacao,projecoes.ESTADOS.FORA_ESCOPO,
    'saída de cliente sem resultado não pode aparecer como pendência de fornecedor');
  const canceladoId = Number(db.prepare(`INSERT INTO movimentos
    (empresa_id,tipo,sentido,nome,inscr_federal,descricao,valor,competencia,reducao,regime,situacao_documento)
    VALUES (?,'fornecedor','entrada','Fornecedor cancelado','66111111000101','Documento cancelado',500,'2027-01','integral','lucro_real','CANCELADO')`).run(empresaId).lastInsertRowid);
  estados = projecoes.reconciliar(db,empresaId,[canceladoId]);
  assert.equal(estados.get(canceladoId).situacao,projecoes.ESTADOS.FORA_ESCOPO,
    'documento cancelado sem resultado não pode aparecer como pendência fiscal vigente');
  console.log('fonte-unica-projecoes.test: contenção, falha e reprocessamento incremental aprovados.');
} finally {
  try { db.close?.(); } catch (_) { /* nada a fazer */ }
  fs.rmSync(dir,{ recursive:true,force:true });
}

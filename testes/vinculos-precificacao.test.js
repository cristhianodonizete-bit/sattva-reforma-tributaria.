#!/usr/bin/env node
/* Persistência e reuso explícito de vínculos; nunca heurística por cadastro. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-vinculos-'));
process.env.SATTVA_DADOS = dir;
const db = require('../src/db');
const prec = require('../src/engine/precificacao');

try {
  const empresaId = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('97000000000001','Fixture vínculo','lucro_real')").run().lastInsertRowid);
  const movSaida = Number(db.prepare("INSERT INTO movimentos (empresa_id,tipo,descricao,ncm,nbs,valor,competencia) VALUES (?, 'cliente','Saída oficial','12345678','01010100',1000,'2027-01')").run(empresaId).lastInsertRowid);
  db.prepare("INSERT INTO motor_execucoes (empresa_id,ano,itens,resumo) VALUES (?,2027,1,'{}')").run(empresaId);
  db.prepare(`INSERT INTO motor_resultados (empresa_id,movimento_id,execucao_id,sentido,ano,status_classificacao,status_credito,natureza,preco_atual,base_economica,cbs,credito_cbs,preco_projetado,tratamento,detalhe)
    VALUES (?,?,1,'saida',2027,'CLASSIFICADO','PROJETADO','CALCULADO',1000,900,83.25,0,983.25,'TRIBUTACAO_INTEGRAL','{}')`).run(empresaId, movSaida);
  const itemId = Number(db.prepare(`INSERT INTO formacao_custo_itens
    (empresa_id,codigo,descricao,tipo,ncm,nbs,movimento_saida_id,status_formacao_custo,origem)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(empresaId,'SKU-1','Produto com vínculo','mercadoria','12345678','01010100',movSaida,'COMPLETO','MANUAL').lastInsertRowid);
  db.prepare(`INSERT INTO formacao_custo_componentes
    (item_formacao_id,descricao_origem,relacionamento,status_alocacao_credito)
    VALUES (?,'Composição persistida','COMPOSICAO','DIRETO')`).run(itemId);
  db.prepare(`INSERT INTO formacao_custo_componentes
    (item_formacao_id,descricao_origem,relacionamento,criterio_rateio,percentual_rateio,status_alocacao_credito)
    VALUES (?,'Rateio persistido','RATEIO','RECEITA_LIQUIDA',0.4,'RATEADO')`).run(itemId);

  // Nova consulta representa nova leitura/execução: o vínculo é o mesmo.
  const recarregado = db.prepare('SELECT * FROM formacao_custo_itens WHERE id=?').get(itemId);
  const componentes = db.prepare('SELECT * FROM formacao_custo_componentes WHERE item_formacao_id=?').all(itemId);
  assert.equal(recarregado.empresa_id, empresaId);
  assert.equal(recarregado.movimento_saida_id, movSaida);
  assert.equal(recarregado.origem, 'MANUAL');
  assert.equal(componentes.length, 2);
  assert.equal(componentes[0].relacionamento, 'COMPOSICAO');
  assert.equal(componentes[1].relacionamento, 'RATEIO');
  assert.equal(componentes[1].criterio_rateio, 'RECEITA_LIQUIDA');
  assert.equal(componentes[1].percentual_rateio, 0.4);

  const saida = db.prepare('SELECT r.*,m.id movimento_id FROM motor_resultados r JOIN movimentos m ON m.id=r.movimento_id WHERE r.movimento_id=?').get(movSaida);
  const completo = prec.analisarItemOficial({ item: recarregado, saida, formacao: { ...recarregado, componentes, status_formacao_custo: 'COMPLETO', custo_economico_bruto_alocado: 600, credito_cbs_total: 0, credito_cbs_direto: 0, credito_cbs_rateado: 0, credito_cbs_nao_alocado: 0, credito_cbs_precificavel: 0 } });
  assert.equal(completo.status, 'COMPLETO', 'vínculo persistido deve ser reutilizado sem nova intervenção');

  // Mesmo NCM/NBS/descrição não habilita uma saída se o id não foi vinculado.
  const semVinculo = prec.analisarItemOficial({ item: { ...recarregado, id: itemId + 1, movimento_saida_id: null }, saida: null, formacao: { status_formacao_custo: 'COMPLETO', componentes } });
  assert.equal(semVinculo.status, 'INCOMPLETO');
  const rateioPendente = prec.analisarItemOficial({
    item: recarregado,
    saida,
    formacao: { ...recarregado, componentes, status_formacao_custo: 'INCOMPLETO', custo_economico_bruto_alocado: 600, credito_cbs_total: 10, credito_cbs_direto: 0, credito_cbs_rateado: 10, credito_cbs_nao_alocado: 0, credito_cbs_precificavel: 10 },
  });
  assert.equal(rateioPendente.status, 'INCOMPLETO', 'rateio sem fechamento não pode gerar precificação definitiva');
  console.log('vinculos-precificacao.test: persistência, reuso explícito e bloqueio de heurística aprovados.');
} finally {
  try { db.close?.(); } catch (_) { /* noop */ }
  fs.rmSync(dir, { recursive: true, force: true });
}

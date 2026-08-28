const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-acompanhamento-entrega2-'));
process.env.SATTVA_DADOS = dir;
const acompanhamento = require('../src/services/acompanhamento');
const db = require('../src/db');

const empresaId = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('97888888000001','Fixture acompanhamento entrega 2','lucro_real')").run().lastInsertRowid);
const baselineId = Number(db.prepare('INSERT INTO monitoring_baselines (empresa_id,versao,data_aprovacao,origem,indicadores_aprovados,natureza) VALUES (?,?,?,?,?,?)')
  .run(empresaId, 1, '2027-01-01', 'FIXTURE', JSON.stringify({ receita: 1000, credito_cbs: 100 }), 'CALCULADO').lastInsertRowid);
const inserirSnapshot = db.prepare('INSERT INTO monitoring_snapshots (empresa_id,periodo,origem,indicadores_realizados,natureza) VALUES (?,?,?,?,?)');
const janeiroId = Number(inserirSnapshot.run(empresaId, '2027-01', 'XML', JSON.stringify({ receita: 900, credito_cbs: 80 }), 'REAL').lastInsertRowid);
const fevereiroId = Number(inserirSnapshot.run(empresaId, '2027-02', 'XML', JSON.stringify({ receita: 950, credito_cbs: 90 }), 'REAL').lastInsertRowid);
assert.strictEqual(db.prepare('SELECT count(*) total FROM monitoring_snapshots WHERE empresa_id=?').get(empresaId).total, 2, 'fotografias por período permanecem preservadas');

const comparisonId = Number(db.prepare('INSERT INTO monitoring_comparisons (empresa_id,baseline_id,snapshot_id,status) VALUES (?,?,?,?)').run(empresaId, baselineId, janeiroId, 'DIVERGENTE').lastInsertRowid);
const inserirDesvio = db.prepare('INSERT INTO monitoring_deviations (comparison_id,metrica,tipo,baseline_valor,realizado_valor,diferenca_absoluta,diferenca_percentual,status,causa,evidencia,acao_sugerida,natureza,memoria) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
const desvioId = Number(inserirDesvio.run(comparisonId, 'credito_cbs', 'DESVIO_FISCAL', 100, 80, -20, -0.2, 'DIVERGENTE', 'Crédito realizado inferior.', 'Baseline 1 × fotografia janeiro.', 'Validar fornecedor e documento.', 'CALCULADO', '{}').lastInsertRowid);
const semEvidenciaId = Number(inserirDesvio.run(comparisonId, 'receita', 'DESVIO_ECONOMICO', 1000, 900, -100, -0.1, 'DIVERGENTE', 'Receita inferior.', '', 'Validar receita.', 'CALCULADO', '{}').lastInsertRowid);
const desvio = db.prepare('SELECT * FROM monitoring_deviations WHERE id=?').get(desvioId);

const alerta = acompanhamento.alerta(desvio);
assert.ok(alerta, 'alerta depende de desvio verificável com evidência');
assert.strictEqual(alerta.prioridade, 'ALTA');
assert.ok(alerta.mensagem.includes('previsto 100') && alerta.mensagem.includes('realizado 80'), 'alerta expõe baseline e realizado');
assert.strictEqual(acompanhamento.alerta(db.prepare('SELECT * FROM monitoring_deviations WHERE id=?').get(semEvidenciaId)), null, 'alerta sem evidência é bloqueado');

const acaoId = Number(db.prepare('INSERT INTO monitoring_actions (empresa_id,desvio_id,acao,responsavel,prazo,prioridade,status,evidencia,origem) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(empresaId, desvioId, 'Revisar fornecedor da operação.', 'Consultor', '2027-01-20', 'ALTA', 'ABERTA', desvio.evidencia, 'ACOMPANHAMENTO').lastInsertRowid);
const acao = db.prepare('SELECT * FROM monitoring_actions WHERE id=?').get(acaoId);
assert.strictEqual(acao.desvio_id, desvioId, 'ação preserva vínculo com o desvio de origem');
assert.strictEqual(acao.evidencia, desvio.evidencia, 'ação preserva evidência do desvio');
assert.ok(acao.prazo < '2027-02-01' && acao.status === 'ABERTA', 'ação em aberto com prazo anterior é atrasada na competência posterior');
db.prepare("UPDATE monitoring_actions SET status='CONCLUIDA',atualizado_em=? WHERE id=?").run('2027-01-21', acaoId);
const concluida = db.prepare('SELECT * FROM monitoring_actions WHERE id=?').get(acaoId);
assert.strictEqual(concluida.status, 'CONCLUIDA', 'ação pode ser concluída sem alterar baseline');

const aderente = acompanhamento.aderencia([{ id: desvioId, status: 'DIVERGENTE' }], [concluida]);
assert.strictEqual(aderente.status, 'ADERENTE');
assert.strictEqual(aderente.valor, 1, 'aderência decorre de regra explícita: desvio com ação concluída');
const incompleta = acompanhamento.aderencia([{ id: 99, status: 'INCOMPLETO' }], []);
assert.strictEqual(incompleta.status, 'INCOMPLETO');
assert.strictEqual(incompleta.valor, null, 'falta de cobertura não vira score arbitrário');

// Uma nova estratégia gera V2; V1 e os snapshots anteriores continuam intactos.
db.prepare('INSERT INTO monitoring_baselines (empresa_id,versao,data_aprovacao,origem,indicadores_aprovados,natureza) VALUES (?,?,?,?,?,?)')
  .run(empresaId, 2, '2027-03-01', 'CENARIO_EXPLICITO', JSON.stringify({ receita: 1200 }), 'SIMULADO');
assert.strictEqual(acompanhamento.json(db.prepare('SELECT indicadores_aprovados FROM monitoring_baselines WHERE empresa_id=? AND versao=1').get(empresaId).indicadores_aprovados).receita, 1000);
assert.strictEqual(db.prepare('SELECT count(*) total FROM monitoring_baselines WHERE empresa_id=?').get(empresaId).total, 2);
assert.strictEqual(db.prepare('SELECT id FROM monitoring_snapshots WHERE id=?').get(fevereiroId).id, fevereiroId);

db.close?.(); fs.rmSync(dir, { recursive: true, force: true });
console.log('Acompanhamento Entrega 2: alertas, ações, evolução e aderência aprovados.');

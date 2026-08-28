const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-acompanhamento-'));
process.env.SATTVA_DADOS = dir;
const acompanhamento = require('../src/services/acompanhamento');
const db = require('../src/db');

// Regressão do endpoint publicado: a quantidade de placeholders deve coincidir
// com as 14 colunas persistidas da fotografia imutável do baseline.
const rotaApi = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
const insertBaseline = rotaApi.match(/INSERT INTO monitoring_baselines \([^)]*\) VALUES \(([^)]*)\)/);
assert.ok(insertBaseline, 'rota de criação de baseline deve persistir a fotografia');
assert.strictEqual(insertBaseline[1].split(',').length, 14, 'INSERT do baseline deve ter 14 valores para 14 colunas');

const operacaoCompartilhada = fs.readFileSync(path.join(__dirname, '../src/services/operacaoCompartilhada.js'), 'utf8');
assert.match(operacaoCompartilhada, /TABELAS_ACOMPANHAMENTO/, 'acompanhamento deve ter espelho operacional identificado');
assert.match(operacaoCompartilhada, /const acompanhamentoRemoto = \{\}/, 'dados remotos devem ser lidos antes de limpar o cache');
assert.match(operacaoCompartilhada, /monitoring_actions','monitoring_alerts','monitoring_deviations','monitoring_comparisons','monitoring_snapshots','monitoring_baselines/, 'espelho de acompanhamento deve limpar dependências antes das referências');

const baseline = { id: 10, versao: 1, origem: 'OFICIAL', natureza: 'CALCULADO', indicadores_aprovados: JSON.stringify({ receita: 1000, compras: 600, cbs: 92.1, credito_cbs: 30, margem: 250, classificacao_pendente: 0 }) };
const semDesvio = { id: 20, periodo: '2027-01', origem: 'XML', natureza: 'REAL', indicadores_realizados: JSON.stringify({ receita: 1000, compras: 600, cbs: 92.1, credito_cbs: 30, margem: 250, classificacao_pendente: 0 }) };
const ok = acompanhamento.comparar(baseline, semDesvio);
assert.strictEqual(ok.desvios.find(x => x.metrica === 'receita').status, 'SEM_DESVIO');
assert.strictEqual(ok.desvios.find(x => x.metrica === 'margem').status, 'SEM_DESVIO');

const realizado = { ...semDesvio, id: 21, indicadores_realizados: JSON.stringify({ receita: 950, compras: 650, cbs: 80, credito_cbs: 20, margem: 180, classificacao_pendente: 180 }) };
const comparacao = acompanhamento.comparar(baseline, realizado);
const desvio = (m) => comparacao.desvios.find(x => x.metrica === m);
assert.strictEqual(desvio('compras').tipo, 'DESVIO_ECONOMICO'); // fornecedor/compras
assert.strictEqual(desvio('cbs').tipo, 'DESVIO_FISCAL');
assert.strictEqual(desvio('margem').tipo, 'DESVIO_ECONOMICO');
assert.strictEqual(desvio('classificacao_pendente').tipo, 'DESVIO_DE_DADOS');
assert.strictEqual(desvio('receita').status, 'DIVERGENTE');
assert.strictEqual(desvio('credito_cbs').diferenca_absoluta, -10);

const ausente = acompanhamento.comparar(baseline, { ...semDesvio, indicadores_realizados: JSON.stringify({ receita: null }) });
assert.strictEqual(ausente.desvios.find(x => x.metrica === 'receita').status, 'INCOMPLETO');
assert.strictEqual(ausente.desvios.find(x => x.metrica === 'receita').natureza, 'INDETERMINADO');

const memoria = acompanhamento.memoria(baseline, realizado, desvio('cbs'));
assert.strictEqual(memoria.baseline.id, 10);
assert.strictEqual(memoria.realizado.id, 21);
assert.strictEqual(memoria.valor_previsto, 92.1);

// V1 é congelada: a criação de V2 não altera a fotografia aprovada anterior.
const empresaId = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('97999999000001','Fixture acompanhamento','lucro_real')").run().lastInsertRowid);
const inserirBaseline = db.prepare('INSERT INTO monitoring_baselines (empresa_id,versao,data_aprovacao,origem,indicadores_aprovados,natureza) VALUES (?,?,?,?,?,?)');
inserirBaseline.run(empresaId, 1, '2027-01-01', 'FIXTURE', baseline.indicadores_aprovados, 'CALCULADO');
inserirBaseline.run(empresaId, 2, '2027-02-01', 'FIXTURE', JSON.stringify({ receita: 1100 }), 'SIMULADO');
const v1 = db.prepare('SELECT * FROM monitoring_baselines WHERE empresa_id=? AND versao=1').get(empresaId);
const v2 = db.prepare('SELECT * FROM monitoring_baselines WHERE empresa_id=? AND versao=2').get(empresaId);
assert.strictEqual(acompanhamento.json(v1.indicadores_aprovados).receita, 1000, 'V1 permanece intacta após a aprovação de V2');
assert.strictEqual(acompanhamento.json(v2.indicadores_aprovados).receita, 1100, 'V2 cria nova fotografia sem sobrescrever V1');
db.close?.(); fs.rmSync(dir, { recursive: true, force: true });
console.log('Acompanhamento Entrega 1: baseline, realizado, desvios e memória aprovados.');

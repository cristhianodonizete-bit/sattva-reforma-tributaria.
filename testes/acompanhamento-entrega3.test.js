const assert = require('assert');
const { PassThrough } = require('stream');
const executivo = require('../src/services/acompanhamentoExecutivo');

const baselineV1 = { id: 1, versao: 1, data_aprovacao: '2027-01-01', origem: 'CENARIO_BASE', natureza: 'CALCULADO', indicadores_aprovados: JSON.stringify({ receita: 1000 }) };
const baselineV2 = { id: 2, versao: 2, data_aprovacao: '2027-03-01', origem: 'DECISAO_EXPLICITA', natureza: 'SIMULADO', indicadores_aprovados: JSON.stringify({ receita: 1100 }) };
const janeiro = { id: 10, periodo: '2027-01', origem: 'XML', natureza: 'REAL', indicadores_realizados: JSON.stringify({ receita: 1000, cbs: 90, credito_cbs: 20, margem: 250, custo_efetivo: 800, cobertura_cadastral: 0.9 }), cobertura_dados: JSON.stringify(0.9) };
const fevereiro = { id: 11, periodo: '2027-02', origem: 'SPED', natureza: 'REAL', indicadores_realizados: JSON.stringify({ receita: 920, cbs: 85, credito_cbs: 15, margem: 210, custo_efetivo: null, cobertura_cadastral: null }), cobertura_dados: JSON.stringify(null) };
const comparacoes = [{ id: 100, baseline_id: 1, snapshot_id: 10, status: 'RECONCILIADO' }, { id: 101, baseline_id: 2, snapshot_id: 11, status: 'INCOMPLETO' }];
const desvios = [
  { id: 200, comparison_id: 100, metrica: 'receita', tipo: 'DESVIO_ECONOMICO', baseline_valor: 1000, realizado_valor: 1000, diferenca_absoluta: 0, diferenca_percentual: 0, status: 'SEM_DESVIO', causa: 'Compatível.', evidencia: 'Snapshot XML 10.', natureza: 'REAL', memoria: '{}' },
  { id: 201, comparison_id: 101, metrica: 'credito_cbs', tipo: 'DESVIO_FISCAL', baseline_valor: 100, realizado_valor: 70, diferenca_absoluta: -30, diferenca_percentual: -0.3, status: 'DIVERGENTE', causa: 'Crédito realizado menor.', evidencia: 'SPED fevereiro.', natureza: 'CALCULADO', memoria: '{}' },
  { id: 202, comparison_id: 101, metrica: 'custo_efetivo', tipo: 'DESVIO_DE_DADOS', baseline_valor: 800, realizado_valor: null, diferenca_absoluta: null, diferenca_percentual: null, status: 'INCOMPLETO', causa: 'Custo não informado.', evidencia: 'Fotografia preserva ausência.', natureza: 'INDETERMINADO', memoria: '{}' },
];
const acoes = [
  { id: 300, desvio_id: 201, acao: 'Revisar fornecedor', responsavel: 'Ana', prazo: '2027-02-10', prioridade: 'ALTA', status: 'ABERTA', evidencia: 'SPED fevereiro.', origem: 'ACOMPANHAMENTO', criado_em: '2027-02-01' },
  { id: 301, desvio_id: 201, acao: 'Validar documento', responsavel: 'Bruno', prazo: '2027-02-20', prioridade: 'MEDIA', status: 'CONCLUIDA', evidencia: 'SPED fevereiro.', origem: 'ACOMPANHAMENTO', atualizado_em: '2027-02-18' },
];
const dados = { empresaId: 1, baselines: [baselineV1, baselineV2], snapshots: [janeiro, fevereiro], comparacoes, desvios, alertas: [], acoes };
const relatorio = executivo.montar(dados, { baseline_id: 2, snapshot_id: 11, data_referencia: '2027-02-15', aderencia: { status: 'INCOMPLETO', valor: null, formula: 'Cobertura insuficiente.' } });

assert.strictEqual(relatorio.baseline.id, 2, 'relatório usa baseline explicitamente selecionado');
assert.strictEqual(relatorio.snapshot.id, 11, 'relatório usa fotografia persistida do período');
assert.strictEqual(relatorio.previsto_realizado.length, 2, 'previsto × realizado vem dos desvios persistidos');
assert.strictEqual(relatorio.previsto_realizado.find((x) => x.metrica === 'credito_cbs').acoes.length, 2, 'drill-down preserva ação ligada ao desvio');
assert.strictEqual(relatorio.indicadores.acoes_atrasadas, 1, 'ação aberta com prazo vencido é indicada como atrasada');
assert.strictEqual(relatorio.indicadores.acoes_concluidas, 1, 'ação concluída permanece explícita');
assert.strictEqual(relatorio.indicadores.aderencia.status, 'INCOMPLETO', 'cobertura incompleta não gera conclusão');
assert.strictEqual(relatorio.indicadores.cobertura_dados, null, 'ausência de cobertura não é transformada em zero');
assert.strictEqual(relatorio.evolucao.length, 2, 'múltiplos períodos ficam preservados');
assert.ok(relatorio.cronologia.some((x) => x.descricao.includes('Baseline V1')) && relatorio.cronologia.some((x) => x.descricao.includes('Baseline V2')), 'V1 não desaparece após V2');
assert.strictEqual(relatorio.limitacoes.length, 1, 'indicador indeterminado continua em limitações');
assert.strictEqual(executivo.statusAcao(acoes[0], '2027-02-15'), 'ATRASADA');

async function pdf(consolidado) {
  const out = new PassThrough(); const partes = []; out.on('data', (x) => partes.push(x));
  const fim = new Promise((resolve, reject) => { out.on('end', resolve); out.on('error', reject); });
  executivo.gerarPdf(relatorio, out, { consolidado }); await fim;
  return Buffer.concat(partes);
}
(async () => {
  const periodo = await pdf(false), consolidado = await pdf(true);
  assert.ok(periodo.slice(0, 4).toString() === '%PDF', 'PDF do período é gerado');
  assert.ok(consolidado.slice(0, 4).toString() === '%PDF', 'PDF consolidado é gerado');
  console.log('Acompanhamento Entrega 3: painel, histórico, plano, drill-down e PDFs aprovados.');
})().catch((e) => { console.error(e); process.exitCode = 1; });

#!/usr/bin/env node
/* Integração da Cadeia com fixture SQLite temporária: sem rede e sem escrita fora dela. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.SATTVA_DADOS) process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-cadeia-'));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fake.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'chave-falsa';

const db = require('../src/db');
const consolidacao = require('../src/services/consolidacaoOficial');

const CNPJ_X = '11222333000181';
const EMPRESA = Number(db.prepare('INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)').run('44555666000177', 'Teste Cadeia').lastInsertRowid);
const EXECUCAO = Number(db.prepare('INSERT INTO motor_execucoes (empresa_id,ano,itens,classificados) VALUES (?,?,?,?)').run(EMPRESA, 2026, 0, 0).lastInsertRowid);

const evidencia = (cnpj, descricao, regime) => JSON.stringify({ fornecedor_vinculado: { cnpj, descricao, regime } });

function inserirLancamento(o) {
  const movimentoId = Number(db.prepare(`INSERT INTO movimentos
    (empresa_id,tipo,documento,competencia,inscr_federal,nome,regime,normalizacao_evidencia,valor,base_calculo,sentido)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(EMPRESA, 'fornecedor', o.documento, '2026-07', o.cnpj || '', o.nome || '',
    o.regime ?? null, o.evidencia ?? null, o.preco, o.preco, 'entrada').lastInsertRowid);
  const detalhe = { reconstrucao: { memoriaPisCofins: { carga_atual_pis_cofins_valor: o.pisCofins, carga_atual_pis_cofins_origem: 'TESTE' } } };
  db.prepare(`INSERT INTO motor_resultados
    (empresa_id,movimento_id,execucao_id,sentido,ano,status_classificacao,status_credito,preco_atual,base_economica,cbs,ibs,
     credito_cbs,credito_ibs,preco_projetado,custo_liquido,cst,cclasstrib,tratamento,regime_cbs_emitente,detalhe)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(EMPRESA, movimentoId, EXECUCAO, 'entrada', 2026,
    'CLASSIFICADO', 'OK', o.preco, o.preco * 0.9, 10, 0, 0, 0, o.preco, 5, '000', '000001', 'integral', 'indeterminado',
    JSON.stringify(detalhe));
  db.prepare(`INSERT INTO projecoes_movimentos_estado
    (empresa_id,movimento_id,assinatura_origem,versao_origem,assinatura_calculada,versao_calculada,situacao,motivo,job_id,atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(EMPRESA, movimentoId, 'a', 1, 'b', 1, 'ATUAL', null, null, '2026-01-01');
  return movimentoId;
}

// Casos de regra. Os lançamentos com CNPJ bruto vazio dependem só da evidência vinculada.
const idA = inserirLancamento({ documento: 'A', preco: 100, cnpj: '', evidencia: evidencia(CNPJ_X, 'FORNECEDOR X', 'lucro_real'), regime: null, pisCofins: null });
const idB = inserirLancamento({ documento: 'B', preco: 100, cnpj: '', evidencia: evidencia(CNPJ_X, 'FORNECEDOR X', 'lucro_presumido'), regime: 'indeterminado', pisCofins: 0 });
const idC = inserirLancamento({ documento: 'C', preco: 100, cnpj: CNPJ_X, nome: 'FORNECEDOR X', evidencia: evidencia(CNPJ_X, 'FORNECEDOR X', 'lucro_real'), regime: 'regime_regular', pisCofins: null });
const idD = inserirLancamento({ documento: 'D', preco: 100, cnpj: '', evidencia: evidencia(CNPJ_X, 'FORNECEDOR X', 'lucro_real'), regime: null, pisCofins: 0 });
db.prepare(`INSERT INTO movimento_decisoes_fiscais (empresa_id,movimento_id,campo,valor,origem,versao)
  VALUES (?,?,?,?,?,?)`).run(EMPRESA, idD, 'REGIME_FORNECEDOR', 'simples_nacional', 'TESTE', 1);

// 105 lançamentos com o mesmo valor e sem PIS/Cofins: exercitam empate e paginação.
for (let i = 0; i < 105; i += 1) inserirLancamento({ documento: `P${i}`, preco: 50, cnpj: CNPJ_X, nome: 'FORNECEDOR X', evidencia: null, regime: 'lucro_real', pisCofins: null });

const totalFotografia = Number(db.prepare('SELECT COUNT(*) q FROM motor_resultados WHERE empresa_id=? AND execucao_id=?').get(EMPRESA, EXECUCAO).q);
const totalEstados = Number(db.prepare('SELECT COUNT(*) q FROM projecoes_movimentos_estado WHERE empresa_id=?').get(EMPRESA).q);
db.prepare(`INSERT INTO fotografia_oficial (empresa_id,execucao_id,empresa_remota_id,execucao_remota_id,quantidade_resultados,quantidade_estados,sincronizado_em)
  VALUES (?,?,?,?,?,?,?)`).run(EMPRESA, EXECUCAO, 1, 1, totalFotografia, totalEstados, '2026-01-01');

const contagens = () => ['movimentos', 'motor_resultados', 'projecoes_movimentos_estado', 'parceiros', 'movimento_decisoes_fiscais', 'fotografia_oficial']
  .map((t) => `${t}=${db.prepare(`SELECT COUNT(*) q FROM ${t}`).get().q}`).join(';');
const antes = contagens();

function todasAsPaginas(opcoes = {}) {
  const itens = []; let meta = null;
  for (let pagina = 1; pagina <= 20; pagina += 1) {
    meta = consolidacao.cadeia(EMPRESA, 'fornecedor', { ...opcoes, paginaDetalhes: pagina });
    itens.push(...meta.detalhes);
    if (!meta.paginacaoDetalhes.temProxima) return { itens, meta };
  }
  throw new Error('paginação não terminou em 20 páginas');
}

const { itens, meta } = todasAsPaginas();
const porDoc = (doc) => itens.find((x) => x.documento === doc);

// 1) CNPJ bruto vazio: a evidência fornece fornecedor e regime.
assert.equal(porDoc('A').cnpj, CNPJ_X, 'CNPJ deve vir da evidência quando o bruto está vazio');
assert.equal(porDoc('A').parceiro, 'FORNECEDOR X', 'nome deve vir da evidência quando não há cadastro');
assert.equal(porDoc('A').regimeFornecedor, 'lucro_real', 'regime da evidência deve ser usado');
// 2) Regime residual conflitante não pode vencer a evidência confirmada.
assert.equal(porDoc('B').regimeFornecedor, 'lucro_presumido', 'evidência deve vencer regime residual indeterminado');
assert.equal(porDoc('C').regimeFornecedor, 'lucro_real', 'evidência deve vencer regime residual regime_regular');
// 3) Decisão fiscal explícita tem prioridade sobre a evidência.
assert.equal(porDoc('D').regimeFornecedor, 'simples_nacional', 'decisão explícita deve vencer a evidência');
// 4) PIS/Cofins nulo é pendência; zero é determinado.
assert.equal(porDoc('A').pisCofinsAtual, null, 'PIS/Cofins nulo deve permanecer pendente');
assert.equal(porDoc('B').pisCofinsAtual, 0, 'PIS/Cofins zero não pode virar pendência');
// 5) Paginação com empate: todos os itens, sem repetição e sem perda.
assert.equal(itens.length, 109, 'todas as páginas devem somar 109 lançamentos');
assert.equal(new Set(itens.map((x) => x.movimento_id)).size, 109, 'nenhum lançamento pode repetir entre páginas');
assert.equal(meta.paginacaoDetalhes.total, 109);
assert.equal(meta.resumoPendenciasPisCofins.registros, 107, 'pendências devem ser contadas no total da fotografia');
assert.ok(consolidacao.cadeia(EMPRESA, 'fornecedor', { limiteDetalhes: 100 }).paginacaoDetalhes.totalPaginas >= 2);
// 6) A leitura não escreve em nenhuma tabela.
assert.equal(contagens(), antes, 'a leitura da Cadeia não pode gravar nada');

console.log('cadeia-rastreabilidade-integracao: fornecedor, regime, pendências, paginação e leitura somente-leitura: OK');

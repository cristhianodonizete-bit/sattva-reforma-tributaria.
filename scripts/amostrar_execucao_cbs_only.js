#!/usr/bin/env node
/*
 * Amostragem determinística da fotografia ativa CBS-only.
 * Só lê o Supabase para atualizar o espelho SQLite e não executa nem publica
 * o motor. Cada linha é validada contra a memória persistida.
 */
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../src/db');
const operacao = require('../src/services/operacaoCompartilhada');

const empresaId = Number(process.argv[2] || 1);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
const json = (v) => { try { return JSON.parse(v || '{}'); } catch (_) { return {}; } };
const igual = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) <= 0.011;

function escolher(linhas, usados, predicado) {
  const x = linhas.find((r) => !usados.has(r.id) && predicado(r));
  if (x) usados.add(x.id);
  return x || null;
}

async function main() {
  await operacao.baixarResultadosMotor();
  const execucao = db.prepare('SELECT * FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(empresaId);
  if (!execucao) throw new Error('Não há execução ativa para a empresa.');
  const linhas = db.prepare(`SELECT r.*, m.documento, m.item_numero, m.competencia, m.nome, m.descricao, m.ncm, m.nbs
    FROM motor_resultados r JOIN movimentos m ON m.id=r.movimento_id
    WHERE r.empresa_id=? ORDER BY r.sentido, r.preco_atual DESC, r.id`).all(empresaId).map((r) => ({ ...r, detalhe: json(r.detalhe) }));
  const saidas = linhas.filter((r) => r.sentido === 'saida');
  const entradas = linhas.filter((r) => r.sentido === 'entrada');
  const usados = new Set();
  const amostra = [
    ['Saída com ISS documental', escolher(saidas, usados, (r) => Number(r.detalhe.reconstrucao?.tributosAtuais?.iss) > 0)],
    ['Saída com PIS/COFINS documental', escolher(saidas, usados, (r) => r.detalhe.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_origem === 'DOCUMENTO')],
    ['Cliente regular determinado', escolher(saidas, usados, (r) => r.regime_cbs_adquirente === 'REGULAR' && r.status_credito_determinacao === 'DETERMINADO')],
    ['Cliente Simples', escolher(saidas, usados, (r) => r.regime_cbs_adquirente === 'SIMPLES_DAS')],
    ['Cliente Pessoa Física', escolher(saidas, usados, (r) => r.regime_cbs_adquirente === 'NAO_CONTRIBUINTE')],
    ['Entrada Simples — premissa 2,5%', escolher(entradas, usados, (r) => r.tipo_credito === 'SIMPLES' && r.status_credito_determinacao === 'DETERMINADO_POR_PREMISSA')],
    ['Entrada fornecedor regular', escolher(entradas, usados, (r) => r.tipo_credito === 'NORMAL' && r.status_credito_determinacao === 'DETERMINADO')],
    ['Operação com validação', escolher(linhas, usados, (r) => ['INDETERMINADO', 'SUJEITO_VALIDACAO'].includes(r.status_credito_determinacao) || ['REQUER_VALIDACAO', 'SEM_CORRESPONDENCIA'].includes(r.status_classificacao))],
    ['Entrada sem crédito (MEI ou equivalente)', escolher(entradas, usados, (r) => r.tipo_credito === 'SEM_CREDITO')],
    ['Saída determinada adicional', escolher(saidas, usados, (r) => r.status_classificacao === 'CLASSIFICADO' && r.status_credito_determinacao === 'DETERMINADO')],
    ['Entrada de maior valor não selecionada', escolher(entradas, usados, () => true)],
  ].filter(([, r]) => r);

  const relatorio = amostra.map(([categoria, r]) => {
    const d = r.detalhe; const rec = d.reconstrucao || {}; const t = rec.tributosAtuais || {}; const a = d.aliquotas || {};
    const baseEsperada = r2(Number(r.preco_atual) - Number(t.pis || 0) - Number(t.cofins || 0));
    const simplesDas = r.regime_cbs_emitente === 'SIMPLES_DAS';
    const cbsEsperada = simplesDas ? r2(Number(r.credito_cbs)) : r2(Number(r.base_economica) * Number(a.cbs || 0));
    const projetadoEsperado = simplesDas ? r2(r.preco_atual) : r2(Number(r.base_economica) + Number(r.cbs) + Number(r.ibs));
    const impacto = r2(Number(r.preco_projetado) - Number(r.preco_atual));
    const impactoPct = r.preco_atual ? r4(impacto / Number(r.preco_atual)) : null;
    const cbsOnly = rec.tipoBaseEconomica === 'CBS_ONLY';
    const checks = {
      memoria_cbs_only: simplesDas || (cbsOnly && Boolean(rec.versaoMetodologiaBase) && rec.baseEconomicaCbs !== undefined && rec.baseEconomicaIntegral !== undefined),
      base_cbs: igual(r.base_economica, baseEsperada),
      iss_preservado: Number(t.iss || 0) === 0 || (Number(rec.componentesRetirados?.iss || 0) === 0 && igual(rec.componentesPreservados?.iss, t.iss)),
      icms_preservado: Number(t.icms || 0) === 0 || (Number(rec.componentesRetirados?.icms || 0) === 0 && igual(rec.componentesPreservados?.icms, t.icms)),
      cbs: igual(r.cbs, cbsEsperada),
      venda_projetada: igual(r.preco_projetado, projetadoEsperado),
      ibs_zero: igual(r.ibs, 0),
      credito_separado: r.sentido !== 'saida' || !['NAO_CONTRIBUINTE', 'SIMPLES_DAS'].includes(r.regime_cbs_adquirente) || igual(r.credito_cbs + r.credito_ibs, 0),
    };
    return {
      categoria, movimento_id: r.movimento_id, documento: r.documento || '', item: r.item_numero || '', competencia: r.competencia || '',
      contraparte: r.nome || '', sentido: r.sentido, regime_emitente: r.regime_cbs_emitente, regime_adquirente: r.regime_cbs_adquirente,
      valor_atual: r2(r.preco_atual), pis: r2(t.pis), cofins: r2(t.cofins), iss_documental: r2(t.iss), icms_documental: r2(t.icms),
      origem_pis_cofins: rec.memoriaPisCofins?.carga_atual_pis_cofins_origem || '', regra_pis_cofins: rec.memoriaPisCofins?.base_reconstrucao_metodo || '',
      status_classificacao: r.status_classificacao, status_reconstrucao: rec.status, tipo_base_economica: rec.tipoBaseEconomica,
      base_cbs_motor: r2(r.base_economica), base_cbs_esperada: baseEsperada, iss_retirado: r2(rec.componentesRetirados?.iss), iss_preservado: r2(rec.componentesPreservados?.iss),
      icms_retirado: r2(rec.componentesRetirados?.icms), icms_preservado: r2(rec.componentesPreservados?.icms), aliquota_cbs: Number(a.cbs || 0),
      cbs_motor: r2(r.cbs), cbs_esperada: cbsEsperada, venda_projetada: r2(r.preco_projetado), venda_projetada_esperada: projetadoEsperado,
      impacto, impacto_pct: impactoPct, credito_cbs: r2(r.credito_cbs), tipo_credito: r.tipo_credito, modalidade_credito: r.modalidade_credito,
      status_credito: r.status_credito_determinacao || r.status_credito, checks, aprovado: Object.values(checks).every(Boolean),
    };
  });
  const saidasResumo = saidas.reduce((a, r) => ({ valor: a.valor + Number(r.preco_atual), base: a.base + Number(r.base_economica), cbs: a.cbs + Number(r.cbs), projetada: a.projetada + Number(r.preco_projetado) }), { valor: 0, base: 0, cbs: 0, projetada: 0 });
  const credito = entradas.reduce((s, r) => s + Number(r.credito_cbs), 0);
  const saidasComIss = saidas.filter((r) => Number(r.detalhe.reconstrucao?.tributosAtuais?.iss || 0) > 0).length;
  const saidasComIcms = saidas.filter((r) => Number(r.detalhe.reconstrucao?.tributosAtuais?.icms || 0) > 0).length;
  const resultado = { execucao: execucao.id, operacoes: linhas.length, saidas: saidas.length, entradas: entradas.length, amostra: relatorio,
    resumo: { saidas_com_iss: saidasComIss, saidas_com_icms: saidasComIcms, amostra_aprovada: relatorio.every((r) => r.aprovado),
      venda_atual: r2(saidasResumo.valor), base_cbs: r2(saidasResumo.base), cbs_debito: r2(saidasResumo.cbs), venda_projetada: r2(saidasResumo.projetada), impacto: r2(saidasResumo.projetada - saidasResumo.valor), impacto_pct: r4((saidasResumo.projetada - saidasResumo.valor) / saidasResumo.valor), credito_cbs_compras: r2(credito), cbs_liquida: r2(saidasResumo.cbs - credito) } };
  const destino = path.join(process.cwd(), 'auditorias', `amostragem-execucao-${execucao.id}-cbs-only.json`);
  fs.writeFileSync(destino, JSON.stringify(resultado, null, 2));
  console.log(JSON.stringify({ ...resultado.resumo, arquivo: destino, categorias: relatorio.map((r) => r.categoria), aprovadas: relatorio.filter((r) => r.aprovado).length, total_amostra: relatorio.length }, null, 2));
  if (!resultado.resumo.amostra_aprovada) process.exitCode = 1;
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });

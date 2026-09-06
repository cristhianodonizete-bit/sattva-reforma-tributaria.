/* Planejamento Tributário: governança da simulação, sem escrever no motor operacional. */
const db = require('../db');
const comparador = require('./comparadorRegimes');

const CENARIOS = ['baseline', 'simples_nacional', 'simples_regime_regular', 'lucro_presumido', 'lucro_real'];
const agora = () => new Date().toISOString();
const texto = (v) => String(v || '').trim();
const json = (v, padrao = null) => { try { return JSON.parse(v); } catch (_) { return padrao; } };
const moeda = (v) => Math.round((Number(v) || 0) * 100) / 100;

function projetar12Meses(linhas, campo) {
  const validas = linhas.filter((x) => /^\d{4}-\d{2}$/.test(String(x.competencia || '')) && Number.isFinite(Number(x[campo])));
  if (!validas.length) return { metodo:'SEM_DADOS', meses:[], total:null };
  const media = validas.reduce((s,x)=>s+Number(x[campo]||0),0) / validas.length;
  const porMes = new Map(); validas.forEach((x) => { const m=String(x.competencia).slice(5); const a=porMes.get(m)||[]; a.push(Number(x[campo]||0)); porMes.set(m,a); });
  const sazonal = validas.length >= 24;
  const meses = Array.from({length:12},(_,i)=>{ const chave=String(i+1).padStart(2,'0'); const valores=porMes.get(chave)||[]; return { mes:chave, valor: moeda(sazonal && valores.length ? valores.reduce((s,v)=>s+v,0)/valores.length : media), origem:sazonal?'SAZONAL_24_MESES':'LINEAR' }; });
  return { metodo:sazonal?'SAZONAL_24_MESES':'LINEAR_COM_ALERTA', meses, total:moeda(meses.reduce((s,x)=>s+x.valor,0)) };
}

function registrar(analiseId, acao, usuarioId, dados = {}) {
  db.prepare('INSERT INTO planejamento_eventos (analise_id,acao,usuario_id,dados_json) VALUES (?,?,?,?)')
    .run(analiseId, acao, usuarioId || null, JSON.stringify(dados));
}

function empresasDaAnalise(analiseId) {
  return db.prepare(`SELECT e.id,e.razao_social,e.regime,p.incluida_consolidado,p.ordem
    FROM planejamento_analise_empresas p JOIN empresas e ON e.id=p.empresa_id
    WHERE p.analise_id=? ORDER BY p.ordem,e.razao_social`).all(analiseId);
}

function resumoEmpresa(empresaId) {
  const leitura = comparador.comparar(db, empresaId);
  const cadastro = db.prepare('SELECT cnpj,cnae,atividade FROM empresas WHERE id=?').get(empresaId) || {};
  const receitas = db.prepare("SELECT competencia,receita_bruta,das FROM perfil_tributario WHERE empresa_id=? AND COALESCE(competencia,'')<>'' ORDER BY competencia").all(empresaId);
  const folhas = db.prepare("SELECT competencia,valor_folha,pro_labore FROM folhas_pagamento_competencias WHERE empresa_id=? AND COALESCE(competencia,'')<>'' ORDER BY competencia").all(empresaId);
  const anosPgdas = new Set(receitas.filter((x) => Number(x.das) > 0).map((x) => String(x.competencia).slice(0, 4)));
  const projecaoReceita = projetar12Meses(receitas, 'receita_bruta');
  const projecaoFolha = projetar12Meses(folhas, 'valor_folha');
  const projecaoProLabore = projetar12Meses(folhas, 'pro_labore');
  const margem = db.prepare('SELECT margem_operacional_percentual FROM margens_operacionais_premissas WHERE empresa_id=? ORDER BY periodo_fim DESC LIMIT 1').get(empresaId);
  return { empresa: { ...leitura.empresa, cnpj: cadastro.cnpj || '', cnae: cadastro.cnae || '', atividade: cadastro.atividade || '' }, receita_analisada: leitura.receita_analisada, cenarios: leitura.cenarios,
    coleta: { meses_receita: receitas.length, meses_folha: folhas.length, pgdas_2024: anosPgdas.has('2024'), pgdas_2025: anosPgdas.has('2025'),
      projecao: projecaoReceita.metodo }, margem_operacional_percentual: margem ? Number(margem.margem_operacional_percentual) : null, projecao_12_meses: { receita:projecaoReceita, folha:projecaoFolha, pro_labore:projecaoProLabore },
    pendencias: leitura.pendencias, status_comparacao: leitura.status_comparacao,
    origem: 'FOTOGRAFIA_LEITURA_MOTOR_E_CADASTROS' };
}

function necessidadesColeta(empresas) {
  return empresas.map((e) => {
    const simples = e.empresa.regime_atual === 'simples_nacional'; const c = e.coleta || {};
    const itens = simples
      ? [{ chave: 'pgdas_2024', titulo: 'PGDAS 2024', recebido: Boolean(c.pgdas_2024) }, { chave: 'pgdas_2025', titulo: 'PGDAS 2025', recebido: Boolean(c.pgdas_2025) }]
      : [{ chave: 'faturamento_24_meses', titulo: 'Faturamento mensal dos últimos 24 meses', recebido: Number(c.meses_receita) >= 24 }];
    itens.push({ chave: 'folha_12_meses', titulo: 'Folha e pró-labore dos últimos 12 meses', recebido: Number(c.meses_folha) >= 12 });
    return { empresa_id: e.empresa.id, empresa: e.empresa.nome, regime: e.empresa.regime_atual, itens,
      alerta: Number(c.meses_receita) >= 24 ? null : 'Projeção linear: histórico mensal insuficiente. Variações de faturamento podem alterar a análise e a recomendação de regime tributário.' };
  });
}

function criar({ titulo, descricao, empresa_ids, periodo_base_inicio, periodo_base_fim, periodo_projecao_inicio, periodo_projecao_fim, responsavel_id, usuario_id }) {
  const ids = [...new Set((empresa_ids || []).map(Number).filter(Boolean))];
  if (!texto(titulo)) throw new Error('Informe o título da análise.');
  if (!ids.length) throw new Error('Selecione ao menos uma empresa.');
  const existentes = db.prepare(`SELECT id FROM empresas WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (existentes.length !== ids.length) throw new Error('Há empresa inválida na análise.');
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO planejamento_analises (titulo,descricao,periodo_base_inicio,periodo_base_fim,periodo_projecao_inicio,periodo_projecao_fim,responsavel_id,criado_por)
      VALUES (?,?,?,?,?,?,?,?)`).run(texto(titulo), texto(descricao), texto(periodo_base_inicio) || null, texto(periodo_base_fim) || null,
      texto(periodo_projecao_inicio) || null, texto(periodo_projecao_fim) || null, responsavel_id || usuario_id || null, usuario_id || null);
    const analiseId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO planejamento_analise_empresas (analise_id,empresa_id,incluida_consolidado,ordem) VALUES (?,?,1,?)');
    ids.forEach((id, ordem) => ins.run(analiseId, id, ordem));
    registrar(analiseId, 'analysis_created', usuario_id, { empresas: ids });
    return analiseId;
  });
  const id = tx(); criarSnapshot(id, usuario_id); return obter(id);
}

function criarSnapshot(analiseId, usuarioId) {
  const analise = db.prepare('SELECT * FROM planejamento_analises WHERE id=?').get(analiseId);
  if (!analise) throw new Error('Análise não encontrada.');
  const empresas = empresasDaAnalise(analiseId).map((e) => resumoEmpresa(e.id));
  const versao = Number(db.prepare('SELECT COALESCE(MAX(versao),0)+1 proxima FROM planejamento_snapshots WHERE analise_id=?').get(analiseId).proxima);
  const dados = { tipo: 'PLANEJAMENTO_TRIBUTARIO', congelado_em: agora(), periodo: {
    base_inicio: analise.periodo_base_inicio, base_fim: analise.periodo_base_fim,
    projecao_inicio: analise.periodo_projecao_inicio, projecao_fim: analise.periodo_projecao_fim,
  }, empresas, necessidades_coleta: necessidadesColeta(empresas), classificacao_origem: 'REAL|CALCULADO|SIMULADO|INDETERMINADO' };
  const r = db.prepare('INSERT INTO planejamento_snapshots (analise_id,versao,dados_json,motor_versao) VALUES (?,?,?,?)')
    .run(analiseId, versao, JSON.stringify(dados), 'motor-operacional-adapter-v1');
  db.prepare("UPDATE planejamento_analises SET atualizado_em=datetime('now','localtime') WHERE id=?").run(analiseId);
  registrar(analiseId, 'snapshot_created', usuarioId, { snapshot_id: Number(r.lastInsertRowid), versao });
  return Number(r.lastInsertRowid);
}

function nivelConfianca(linhas) {
  const completos = linhas.filter((x) => x.status === 'COMPLETO').length;
  if (completos === linhas.length && completos > 0) return 'ALTA';
  if (completos > 0) return 'MEDIA';
  return 'BAIXA';
}

function premissaNumerica(premissas, campo, padrao = 0) {
  const p = premissas.filter((x) => x.campo === campo).at(0); const v = Number(p?.valor);
  return Number.isFinite(v) ? v : padrao;
}
function estrategiaPreco(premissas) {
  return String(premissas.find((x) => x.campo === 'estrategia_preco')?.valor || 'MANTER_PRECO').toUpperCase();
}
function projetarResultadoEmpresa(x, item, premissas) {
  const p = x.projecao_12_meses || {}; const receitaBase = Number(x.receita_analisada || 0);
  const receitaProjetadaBase = p.receita?.total; const impacto = premissaNumerica(premissas, 'impacto_reforma_percentual', 0);
  const repasse = Math.max(0, Math.min(1, premissaNumerica(premissas, 'percentual_repasse', 0)));
  const estrategia = estrategiaPreco(premissas); const margemBase = x.margem_operacional_percentual;
  if (receitaProjetadaBase === null || receitaProjetadaBase === undefined || !receitaBase) return { ...item, status:'DADOS_INSUFICIENTES', pendencias:[...(item.pendencias||[]),'Receita histórica insuficiente para projetar 12 meses.'] };
  let receitaProjetada = Number(receitaProjetadaBase), margemProjetada = margemBase === null ? null : margemBase / 100;
  if (margemProjetada !== null) {
    if (estrategia === 'PRESERVAR_MARGEM' && margemProjetada < 1) receitaProjetada = receitaProjetada * (1 + impacto / Math.max(.01, 1 - margemProjetada));
    else if (estrategia === 'REPASSE_PARCIAL') margemProjetada -= impacto * (1 - repasse);
    else margemProjetada -= impacto;
  }
  const fator = receitaProjetada / receitaBase; const inssHistorico = Number(item.componentes_disponiveis?.inss_patronal?.valor || 0);
  const inssProjetado = (Number(p.folha?.total || 0) * .268) + (Number(p.pro_labore?.total || 0) * .20);
  const tributosSemInss = item.tributos_estimados === null ? null : Math.max(0, Number(item.tributos_estimados) - inssHistorico);
  const tributos = tributosSemInss === null ? null : moeda(tributosSemInss * fator + inssProjetado);
  const lucroAntesIr = margemProjetada === null ? null : moeda(receitaProjetada * margemProjetada - inssProjetado);
  const pendencias = [...(item.pendencias||[])]; if (margemProjetada === null) pendencias.push('Margem operacional não informada: lucro antes de IRPJ/CSLL permanece indicativo.');
  return { ...item, receita_projetada_12_meses:moeda(receitaProjetada), tributos_estimados:tributos, carga_efetiva_percentual:tributos!==null&&receitaProjetada>0?tributos/receitaProjetada:null,
    inss_patronal_projetado:moeda(inssProjetado), lucro_antes_irpj_csll:lucroAntesIr, margem_projetada_percentual:margemProjetada===null?null:margemProjetada*100,
    memoria_projecao:{ metodo_receita:p.receita?.metodo||'SEM_DADOS', estrategia_preco:estrategia, impacto_reforma_percentual:impacto, percentual_repasse:repasse, inss_folha:.268, inss_pro_labore:.20 }, pendencias };
}
function intercompany(empresas) {
  const cnpjs = empresas.map((x)=>String(x.empresa.cnpj||'').replace(/\D/g,'')).filter(Boolean); if (cnpjs.length < 2) return 0;
  try { return moeda(db.prepare(`SELECT SUM(COALESCE(valor,0)) valor FROM movimentos WHERE (tipo='cliente' OR sentido='saida') AND replace(replace(replace(inscr_federal,'.',''),'/',''),'-','') IN (${cnpjs.map(()=>'?').join(',')})`).get(...cnpjs).valor); } catch (_) { return 0; }
}

function executar(analiseId, usuarioId) {
  const snapshot = db.prepare('SELECT * FROM planejamento_snapshots WHERE analise_id=? ORDER BY versao DESC LIMIT 1').get(analiseId);
  if (!snapshot) throw new Error('A análise não possui fotografia.');
  const dados = json(snapshot.dados_json, {});
  const premissas = db.prepare('SELECT * FROM planejamento_premissas WHERE analise_id=? ORDER BY id DESC').all(analiseId);
  const resultados = CENARIOS.map((cenario) => {
    const chave = cenario === 'baseline' ? null : cenario;
    const empresas = (dados.empresas || []).map((x) => {
      const item = chave ? x.cenarios.find((c) => c.chave === chave) : x.cenarios.find((c) => c.chave === x.empresa.regime_atual);
      return { empresa: x.empresa, resultado: projetarResultadoEmpresa(x, item || { status: 'INDETERMINADO', tributos_estimados: null, pendencias: ['Regime atual sem cenário correspondente.'], componentes_disponiveis:{} }, premissas.filter((p)=>!p.cenario || p.cenario===cenario)) };
    });
    const pendencias = empresas.flatMap((x) => x.resultado.pendencias || []);
    const invalidos = empresas.filter((x) => x.resultado.status !== 'COMPLETO' || x.resultado.tributos_estimados === null);
    const tributos = invalidos.length ? null : moeda(empresas.reduce((s, x) => s + Number(x.resultado.tributos_estimados || 0), 0));
    const receita = moeda(empresas.reduce((s, x) => s + Number(x.resultado.receita_projetada_12_meses || 0), 0));
    return { cenario, status: invalidos.length ? (empresas.some((x) => x.resultado.status === 'PARCIAL') ? 'INDICATIVO' : 'DADOS_INSUFICIENTES') : 'COMPLETO',
      confianca: nivelConfianca(empresas.map((x) => x.resultado)), receita_total: receita, tributos_total: tributos,
      carga_efetiva_percentual: tributos !== null && receita > 0 ? tributos / receita : null,
      resultado_apos_tributos: tributos !== null ? moeda(receita - tributos) : null,
      empresas, pendencias: [...new Set(pendencias)] };
  });
  const baseline = resultados.find((x) => x.cenario === 'baseline');
  const completos = resultados.filter((x) => x.cenario !== 'baseline' && x.status === 'COMPLETO' && x.tributos_total !== null);
  const vencedor = completos.length ? completos.reduce((a, b) => a.tributos_total <= b.tributos_total ? a : b) : null;
  for (const r of resultados) r.economia_vs_baseline = baseline?.tributos_total !== null && r.tributos_total !== null ? moeda(baseline.tributos_total - r.tributos_total) : null;
  const recomendacao = vencedor && vencedor.confianca !== 'BAIXA' ? { status: 'CENARIO_RECOMENDADO', cenario: vencedor.cenario,
    justificativa: 'Menor carga entre cenários completos e elegíveis na fotografia congelada.', confianca: vencedor.confianca } :
    { status: 'CENARIO_INDICATIVO_REQUER_VALIDACAO', cenario: null, justificativa: 'Não há comparação completa suficiente para decisão automática.', confianca: 'BAIXA' };
  const tx = db.transaction(() => {
    const upsert = db.prepare(`INSERT INTO planejamento_resultados (analise_id,snapshot_id,cenario,status,confianca,resultado_json)
      VALUES (?,?,?,?,?,?) ON CONFLICT(analise_id,snapshot_id,cenario) DO UPDATE SET status=excluded.status,confianca=excluded.confianca,resultado_json=excluded.resultado_json,calculado_em=datetime('now','localtime')`);
    resultados.forEach((r) => upsert.run(analiseId, snapshot.id, r.cenario, r.status, r.confianca, JSON.stringify(r)));
    db.prepare("UPDATE planejamento_analises SET status='EM_REVISAO',atualizado_em=datetime('now','localtime') WHERE id=?").run(analiseId);
    registrar(analiseId, 'scenario_calculated', usuarioId, { snapshot_id: snapshot.id, recomendacao });
  }); tx();
  const valorIntercompany = intercompany(dados.empresas || []);
  return { snapshot_id: snapshot.id, resultados, recomendacao, consolidado_grupo: resultados.map((r) => ({ cenario: r.cenario, tributos_total: r.tributos_total, receita_bruta: r.receita_total, receita_eliminando_intercompany: moeda(r.receita_total - valorIntercompany), intercompany_identificado:valorIntercompany, status: r.status, empresas: r.empresas.length })) };
}

function adicionarPremissa(analiseId, dados, usuarioId) {
  if (!texto(dados.campo) || dados.valor === undefined) throw new Error('Informe campo e valor da premissa.');
  const origem = ['REAL', 'PROJETADO', 'PREMISSA_MANUAL'].includes(dados.origem) ? dados.origem : 'PREMISSA_MANUAL';
  const r = db.prepare(`INSERT INTO planejamento_premissas (analise_id,cenario,escopo,campo,valor,tipo,origem,justificativa,responsavel_id)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(analiseId, texto(dados.cenario) || null, texto(dados.escopo) || 'ANALISE', texto(dados.campo), String(dados.valor), texto(dados.tipo) || 'OPERACIONAL', origem, texto(dados.justificativa) || null, usuarioId || null);
  registrar(analiseId, 'premise_changed', usuarioId, { premissa_id: Number(r.lastInsertRowid), campo: dados.campo, origem });
  return Number(r.lastInsertRowid);
}

function aprovar(analiseId, observacao, usuarioId) {
  const r = db.prepare("UPDATE planejamento_analises SET status='APROVADA',atualizado_em=datetime('now','localtime') WHERE id=? AND status='EM_REVISAO'").run(analiseId);
  if (!r.changes) throw new Error('Execute a análise antes de aprová-la.');
  registrar(analiseId, 'approved', usuarioId, { observacao: texto(observacao) || null });
}

function listar() {
  return db.prepare(`SELECT a.*, COUNT(DISTINCT ae.empresa_id) empresas,
    (SELECT resultado_json FROM planejamento_resultados r WHERE r.analise_id=a.id ORDER BY r.calculado_em DESC LIMIT 1) ultimo_resultado
    FROM planejamento_analises a LEFT JOIN planejamento_analise_empresas ae ON ae.analise_id=a.id
    GROUP BY a.id ORDER BY a.atualizado_em DESC`).all().map((x) => ({ ...x, ultimo_resultado: json(x.ultimo_resultado) }));
}
function obter(analiseId) {
  const analise = db.prepare('SELECT * FROM planejamento_analises WHERE id=?').get(analiseId);
  if (!analise) throw new Error('Análise não encontrada.');
  const snapshot = db.prepare('SELECT id,versao,dados_json,motor_versao,criado_em FROM planejamento_snapshots WHERE analise_id=? ORDER BY versao DESC LIMIT 1').get(analiseId);
  return { analise, empresas: empresasDaAnalise(analiseId), snapshot: snapshot ? { ...snapshot, dados: json(snapshot.dados_json) } : null,
    premissas: db.prepare('SELECT * FROM planejamento_premissas WHERE analise_id=? ORDER BY id DESC').all(analiseId),
    resultados: snapshot ? db.prepare('SELECT * FROM planejamento_resultados WHERE analise_id=? AND snapshot_id=? ORDER BY id').all(analiseId, snapshot.id).map((r) => ({ ...r, resultado: json(r.resultado_json) })) : [],
    eventos: db.prepare('SELECT * FROM planejamento_eventos WHERE analise_id=? ORDER BY id DESC LIMIT 100').all(analiseId).map((r) => ({ ...r, dados: json(r.dados_json, {}) })), };
}
module.exports = { CENARIOS, criar, criarSnapshot, executar, adicionarPremissa, aprovar, listar, obter };

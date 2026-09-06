/* Assistente de Planejamento Tributário: explica leituras certificadas, sem calcular ou alterar regras. */
const db = require('../db');
const ia = require('./ia');
const planejamento = require('./planejamentoTributario');

const texto = (v) => String(v || '').trim();
const json = (v, padrao = {}) => { try { return JSON.parse(v); } catch (_) { return padrao; } };

function contextoSeguro(detalhe) {
  const resultados = (detalhe.resultados || []).map((x) => x.resultado || x).map((r) => ({
    cenario: r.cenario, status: r.status, confianca: r.confianca,
    receita_total: r.receita_total, tributos_total: r.tributos_total,
    carga_efetiva_percentual: r.carga_efetiva_percentual,
    economia_vs_baseline: r.economia_vs_baseline,
    resultado_apos_tributos: r.resultado_apos_tributos,
    consolidado_grupo: r.consolidado_grupo, pendencias: r.pendencias || [],
    empresas: (r.empresas || []).map((x) => ({
      empresa: { id: x.empresa?.id, nome: x.empresa?.nome || x.empresa?.razao_social, regime_atual: x.empresa?.regime_atual || x.empresa?.regime },
      status: x.resultado?.status, tributos_estimados: x.resultado?.tributos_estimados,
      receita_projetada_12_meses: x.resultado?.receita_projetada_12_meses,
      inss_patronal_projetado: x.resultado?.inss_patronal_projetado,
      lucro_antes_irpj_csll: x.resultado?.lucro_antes_irpj_csll,
      margem_projetada_percentual: x.resultado?.margem_projetada_percentual,
      pendencias: x.resultado?.pendencias || [],
    })),
  }));
  return {
    estudo: { id: detalhe.analise.id, titulo: detalhe.analise.titulo, status: detalhe.analise.status, snapshot_versao: detalhe.snapshot?.versao || null },
    empresas: (detalhe.empresas || []).map((x) => ({ id:x.id, razao_social:x.razao_social, regime:x.regime, incluida_consolidado:Boolean(x.incluida_consolidado) })),
    fotografia: { congelado_em: detalhe.snapshot?.dados?.congelado_em || null, necessidades_coleta: detalhe.snapshot?.dados?.necessidades_coleta || [] },
    premissas: (detalhe.premissas || []).map((x) => ({ campo:x.campo, valor:x.valor, origem:x.origem, tipo:x.tipo, justificativa:x.justificativa })), resultados,
  };
}

const SISTEMA = `Você é o Assistente Tributário Sênior do Sattva. Sua função é explicar uma análise de planejamento tributário já calculada pelo motor determinístico.

Limites inegociáveis:
- Os dados fornecidos são a única fonte para números, regimes, alíquotas, benefícios e conclusões do caso. Não invente fatos, legislação, classificações ou cálculos.
- Não recomende alterar cadastro, regime, motor, catálogo, documento ou regra fiscal. Nunca diga que uma mudança foi aplicada.
- Diferencie expressamente: CALCULADO, PREMISSA, EVIDÊNCIA HISTÓRICA e PENDÊNCIA.
- Quando faltar informação, diga qual dado falta e como ele limita a conclusão. Não presuma Fator R, crédito de adquirente, eliminação fiscal intercompany ou enquadramento.
- O DAS histórico do Simples é evidência preservada; não o reconstrua por inferência.
- A recomendação final é humana. Não use linguagem de certeza quando a confiança for média ou baixa.
- Responda em português do Brasil, de forma objetiva. Use seções curtas: Resposta, Evidências, Premissas e Pendências/Riscos quando aplicável.`;

function validarPergunta(pergunta) {
  const p = texto(pergunta);
  if (p.length < 3) throw new Error('Digite uma pergunta para o assistente tributário.');
  if (p.length > 3000) throw new Error('A pergunta pode ter no máximo 3.000 caracteres.');
  return p;
}

async function perguntar(analiseId, pergunta, usuarioId) {
  const detalhe = planejamento.obter(analiseId);
  const p = validarPergunta(pergunta);
  if (!detalhe.snapshot) throw new Error('Crie uma fotografia antes de consultar o assistente tributário.');
  if (!(detalhe.resultados || []).length) throw new Error('Execute os cenários antes de consultar o assistente tributário.');
  const contexto = contextoSeguro(detalhe);
  const r = await ia.chamar([{ role:'user', content:`CONTEXTO CERTIFICADO DA ANÁLISE (JSON):\n${JSON.stringify(contexto)}\n\nPERGUNTA DO USUÁRIO:\n${p}` }], { sistema:SISTEMA, maxTokens:2400, temperatura:0 });
  const registro = db.prepare(`INSERT INTO planejamento_assistente_interacoes
    (analise_id,snapshot_id,usuario_id,pergunta,resposta,modelo,uso_json,contexto_json) VALUES (?,?,?,?,?,?,?,?)`)
    .run(analiseId, detalhe.snapshot.id, usuarioId || null, p, r.texto, ia.config().modelo, JSON.stringify(r.uso || {}), JSON.stringify(contexto));
  db.prepare('INSERT INTO planejamento_eventos (analise_id,acao,usuario_id,dados_json) VALUES (?,?,?,?)')
    .run(analiseId, 'assistant_consulted', usuarioId || null, JSON.stringify({ interacao_id:Number(registro.lastInsertRowid), snapshot_id:detalhe.snapshot.id }));
  return { id:Number(registro.lastInsertRowid), pergunta:p, resposta:r.texto, modelo:ia.config().modelo, uso:r.uso || {}, snapshot_id:detalhe.snapshot.id };
}

function historico(analiseId) {
  return db.prepare(`SELECT id,analise_id,snapshot_id,usuario_id,pergunta,resposta,modelo,uso_json,criado_em
    FROM planejamento_assistente_interacoes WHERE analise_id=? ORDER BY id DESC LIMIT 50`).all(analiseId)
    .map((x) => ({ ...x, uso:json(x.uso_json, {}) }));
}

module.exports = { perguntar, historico, contextoSeguro, validarPergunta };

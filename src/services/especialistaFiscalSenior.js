/* Especialista Fiscal Sênior: IA consultiva, fundamentada e sem poder de escrita fiscal. */
const db = require('../db');
const ia = require('./ia');
const rag = require('./rag');

const texto = (v) => String(v || '').trim();
const seguro = (v, padrao = []) => { try { return JSON.parse(v); } catch (_) { return padrao; } };

const SISTEMA = `Você é o Especialista Fiscal Sênior do Sattva, com foco na aplicação da legislação brasileira atual de PIS/Cofins e na transição para CBS/IBS.

Regras inegociáveis:
- Use exclusivamente os fatos da empresa e os trechos de fontes recuperados no contexto. Cite [F1], [F2] etc. para cada conclusão jurídica material.
- Não invente leis, alíquotas, benefícios, NCM/NBS, CST, cClassTrib, vigência, crédito ou fato operacional. Se a base não sustentar a resposta, declare INFORMAÇÃO INSUFICIENTE.
- Diferencie expressamente: REGRA ATUAL PIS/COFINS, REGRA CBS/IBS, FATO COMPROVADO, PREMISSA e PENDÊNCIA.
- Não altera cadastro, documentos, motor, catálogo, regra, cálculo ou regime. Quando identificar possível ajuste, produza somente uma SUGESTÃO PARA REVISÃO HUMANA.
- Não trate divergência documental como erro material sem demonstrar impacto econômico ou fiscal.
- Responda em português brasileiro, de forma objetiva, nas seções: Conclusão técnica; Fundamentação; Fatos considerados; Pendências/Riscos; Próxima validação humana.`;

function empresaContexto(empresaId) {
  if (!empresaId) return null;
  const empresa = db.prepare('SELECT id,razao_social,cnpj,regime,regime_resolvido,cnae,cnaes_secundarios,atividade FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada para a consulta fiscal.');
  return empresa;
}

function validarPergunta(pergunta) {
  const p = texto(pergunta);
  if (p.length < 8) throw new Error('Descreva a questão fiscal com pelo menos 8 caracteres.');
  if (p.length > 4000) throw new Error('A pergunta pode ter no máximo 4.000 caracteres.');
  return p;
}

async function perguntar({ pergunta, empresaId = null, usuarioId = null } = {}) {
  const cfg = ia.config();
  if (!cfg.especialistaFiscalAtivo) throw new Error('Especialista Fiscal Sênior está desligado pela administração.');
  if (!cfg.ativo) throw new Error('Configure a chave da IA antes de ligar o Especialista Fiscal Sênior.');
  const p = validarPergunta(pergunta);
  const empresa = empresaContexto(empresaId ? Number(empresaId) : null);
  const contexto = rag.montarContexto([p, 'PIS Cofins CBS IBS reforma tributária legislação'], 10, 20);
  if (!contexto.texto) throw new Error('A base jurídica está vazia. Cadastre fontes normativas antes de consultar o Especialista Fiscal Sênior.');
  const fatos = empresa ? JSON.stringify({ empresa }) : 'Nenhuma empresa foi selecionada; responda somente em tese.';
  const consulta = [{ role: 'user', content: `FONTES RECUPERADAS:\n${contexto.texto}\n\nFATOS DA CONSULTA:\n${fatos}\n\nPERGUNTA:\n${p}` }];
  const resposta = await ia.chamar(consulta, { sistema: SISTEMA, maxTokens: 3200, temperatura: 0, fallback: true });
  // A conferência cruzada é opt-in: evita custo e compartilhamento adicional
  // de dados quando a administração não a habilitou expressamente.
  const revisores = cfg.especialistaPainelAtivo
    ? cfg.provedores.filter((x) => x.ativo && x.papel === 'revisor' && x.id !== resposta.provedor)
    : [];
  const pareceres = [];
  for (const revisor of revisores) {
    try {
      const r = await ia.chamar(consulta, {
        sistema: `${SISTEMA}\n\nVocê atua como REVISOR INDEPENDENTE. Não substitua a resposta principal: aponte apenas conclusões sem fonte, divergências factuais, premissas ausentes e o que exige revisão humana.`,
        maxTokens: 1800, temperatura: 0, provedorId: revisor.id, fallback: false,
      });
      pareceres.push({ provedor: r.provedor, modelo: r.modelo, resposta: r.texto, uso: r.uso || {} });
    } catch (e) { pareceres.push({ provedor: revisor.id, modelo: revisor.modelo, erro: e.message }); }
  }
  const respostaAuditada = pareceres.length
    ? `${resposta.texto}\n\n--- PARECERES INDEPENDENTES ---\n${pareceres.map((x) => `${x.provedor}/${x.modelo}: ${x.resposta || `INDISPONÍVEL — ${x.erro}`}`).join('\n\n')}`
    : resposta.texto;
  const gravada = db.prepare(`INSERT INTO especialista_fiscal_interacoes (empresa_id,usuario_id,pergunta,resposta,modelo,fontes_json,uso_json)
    VALUES (?,?,?,?,?,?,?)`).run(empresa?.id || null, usuarioId || null, p, respostaAuditada, resposta.modelo || cfg.modelo, JSON.stringify(contexto.trechos), JSON.stringify({ principal: resposta.uso || {}, pareceres }));
  return { id: Number(gravada.lastInsertRowid), resposta: resposta.texto, fontes: contexto.trechos,
    provedor: resposta.provedor, modelo: resposta.modelo || cfg.modelo, uso: resposta.uso || {}, pareceres };
}

function historico({ empresaId = null, limite = 20 } = {}) {
  const n = Math.min(50, Math.max(1, Number(limite) || 20));
  const linhas = empresaId
    ? db.prepare('SELECT * FROM especialista_fiscal_interacoes WHERE empresa_id=? ORDER BY id DESC LIMIT ?').all(Number(empresaId), n)
    : db.prepare('SELECT * FROM especialista_fiscal_interacoes ORDER BY id DESC LIMIT ?').all(n);
  return linhas.map((x) => ({ ...x, fontes: seguro(x.fontes_json), uso: seguro(x.uso_json, {}) }));
}

module.exports = { perguntar, historico, validarPergunta };

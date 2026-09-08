/**
 * ANÁLISE DE CONTRATOS COM IA
 * ---------------------------------------------------------------------------
 * Aceita contrato em PDF, imagem (foto/scan) ou texto. O PDF e a imagem vão
 * direto ao modelo, que faz a leitura — sem OCR local, sem dependência nativa.
 * O texto extraído é reaproveitado para a busca na base de conhecimento (RAG),
 * e a análise final é feita com os trechos recuperados como fundamento.
 *
 * Configuração: variável de ambiente ANTHROPIC_API_KEY (arquivo .env) ou pela
 * tela "Base de conhecimento" do sistema.
 */
const db = require('../db');
const rag = require('./rag');
const { CLAUSULAS } = require('../config/conteudo');

const API = 'https://api.anthropic.com/v1/messages';
const VERSAO = '2023-06-01';

// A base jurídica é única (RAG e fontes cadastradas). Estes provedores são
// apenas modelos de raciocínio: nenhum deles vira fonte normativa por si só.
// As chaves cadastradas pela tela nunca voltam para o navegador: apenas o
// indicador "configurada" é exposto pela API.
const PROVEDORES_PADRAO = [
  { id: 'anthropic', nome: 'Anthropic', modelo: 'claude-sonnet-5', papel: 'principal', env: 'ANTHROPIC_API_KEY' },
  { id: 'openai', nome: 'OpenAI', modelo: 'gpt-5-mini', papel: 'revisor', env: 'OPENAI_API_KEY' },
  { id: 'gemini', nome: 'Google Gemini', modelo: 'gemini-2.5-flash', papel: 'revisor', env: 'GOOGLE_AI_API_KEY' },
  { id: 'groq', nome: 'Groq', modelo: 'llama-3.3-70b-versatile', papel: 'revisor', env: 'GROQ_API_KEY' },
  { id: 'ollama', nome: 'Ollama', modelo: 'llama3.1:8b', papel: 'revisor', env: 'OLLAMA_BASE_URL' },
];

function jsonSeguro(valor, padrao) { try { return JSON.parse(valor); } catch (_) { return padrao; } }
function provedorSalvo(id, row) {
  return jsonSeguro(row?.provedores_json, []).find((p) => p?.id === id) || {};
}
function chaveDoProvedor(id, row) {
  const salva = String(provedorSalvo(id, row).chave || '');
  if (id === 'anthropic') return process.env.ANTHROPIC_API_KEY || row.api_key || salva;
  if (id === 'openai') return process.env.OPENAI_API_KEY || salva;
  if (id === 'gemini') return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || salva;
  if (id === 'groq') return process.env.GROQ_API_KEY || salva;
  if (id === 'ollama') return process.env.OLLAMA_BASE_URL || salva;
  return '';
}
function origemDaChave(id, row) {
  const ambiente = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    ollama: process.env.OLLAMA_BASE_URL,
  }[id];
  if (ambiente) return 'variável de ambiente';
  if (id === 'anthropic' && row.api_key) return 'configuração do sistema (legada)';
  return provedorSalvo(id, row).chave ? 'configuração do sistema' : 'não configurada';
}

function normalizarProvedores(valor, row) {
  const salvos = new Map((Array.isArray(valor) ? valor : []).filter(Boolean).map((p) => [p.id, p]));
  return PROVEDORES_PADRAO.map((padrao) => {
    const salvo = salvos.get(padrao.id) || {};
    const chave = chaveDoProvedor(padrao.id, row);
    return {
      id: padrao.id, nome: padrao.nome, env: padrao.env,
      modelo: String(salvo.modelo || (padrao.id === 'anthropic' ? row.modelo : padrao.modelo)),
      papel: ['principal', 'revisor', 'desativado'].includes(salvo.papel) ? salvo.papel : padrao.papel,
      configurado: Boolean(chave),
      ativo: salvo.papel !== 'desativado' && Boolean(chave),
    };
  });
}

function config() {
  const row = db.prepare('SELECT * FROM ia_config WHERE id = 1').get() || {};
  const provedores = normalizarProvedores(jsonSeguro(row.provedores_json, []), row);
  const principal = provedores.find((p) => p.ativo && p.papel === 'principal') || provedores.find((p) => p.ativo) || null;
  return {
    chave: process.env.ANTHROPIC_API_KEY || row.api_key || '',
    modelo: row.modelo || process.env.ANTHROPIC_MODELO || 'claude-sonnet-5',
    ativo: Boolean(principal),
    especialistaFiscalAtivo: Boolean(row.especialista_fiscal_ativo),
    especialistaPainelAtivo: Boolean(row.especialista_painel_ativo),
    provedores,
    provedorPrincipal: principal?.id || null,
    origemChave: principal ? `${principal.nome}: ${origemDaChave(principal.id, row)}` : 'não configurada',
  };
}

function salvarConfig({ api_key, modelo, especialista_fiscal_ativo, especialista_painel_ativo, provedores, chaves = {} }) {
  const atual = db.prepare('SELECT api_key,especialista_fiscal_ativo,especialista_painel_ativo,provedores_json FROM ia_config WHERE id=1').get() || {};
  const anteriores = new Map(jsonSeguro(atual.provedores_json, []).filter(Boolean).map((p) => [p.id, p]));
  const lista = Array.isArray(provedores) ? provedores.map((p) => {
    const anterior = anteriores.get(p.id) || {};
    const novaChave = String(chaves?.[p.id] || '').trim();
    return {
      id: p.id, modelo: String(p.modelo || ''), papel: ['principal', 'revisor', 'desativado'].includes(p.papel) ? p.papel : 'desativado',
      chave: novaChave || String(anterior.chave || ''),
    };
  }) : jsonSeguro(atual.provedores_json, []);
  const principais = lista.filter((p) => p.papel === 'principal');
  if (principais.length > 1) throw new Error('Escolha somente uma IA principal para o Especialista Fiscal.');
  db.prepare(`UPDATE ia_config SET api_key = ?, modelo = ?, especialista_fiscal_ativo = ?, especialista_painel_ativo = ?, provedores_json = ?, atualizado_em = datetime('now','localtime') WHERE id = 1`)
    .run(api_key === undefined ? atual.api_key || '' : api_key,
      modelo || 'claude-sonnet-5', especialista_fiscal_ativo === undefined ? Number(atual.especialista_fiscal_ativo || 0) : (especialista_fiscal_ativo ? 1 : 0),
      especialista_painel_ativo === undefined ? Number(atual.especialista_painel_ativo || 0) : (especialista_painel_ativo ? 1 : 0), JSON.stringify(lista));
  return config();
}

async function chamarAnthropic(mensagens, { sistema, maxTokens, temperatura, provedor, chave }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180000);
  try {
    const resp = await fetch(API, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': VERSAO },
      // Alguns modelos Claude recentes aceitam somente a configuração padrão
      // de temperatura; omitir preserva a compatibilidade sem afetar o uso.
      body: JSON.stringify({ model: provedor.modelo, max_tokens: maxTokens, system: sistema, messages: mensagens }),
    });
    const texto = await resp.text(); let dados; try { dados = JSON.parse(texto); } catch (_) { dados = null; }
    if (!resp.ok) throw new Error(dados?.error?.message || `Anthropic respondeu ${resp.status}`);
    return { texto: (dados.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'), uso: dados.usage || {} };
  } finally { clearTimeout(t); }
}

async function chamarOpenAiCompativel(mensagens, { sistema, maxTokens, temperatura, provedor, chave }) {
  const origem = provedor.id === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
  // A API atual da OpenAI (inclusive GPT-5) substituiu max_tokens por
  // max_completion_tokens. Groq continua compatível com max_tokens.
  const limite = provedor.id === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
  const amostragem = provedor.id === 'openai' && /^gpt-5/i.test(provedor.modelo) ? {} : { temperature: temperatura };
  const resp = await fetch(`${origem}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
    body: JSON.stringify({ model: provedor.modelo, ...limite, ...amostragem, messages: [{ role: 'system', content: sistema }, ...mensagens] }) });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados?.error?.message || `${provedor.nome} respondeu ${resp.status}`);
  return { texto: dados?.choices?.[0]?.message?.content || '', uso: dados.usage || {} };
}

async function chamarGemini(mensagens, { sistema, maxTokens, temperatura, provedor, chave }) {
  const prompt = mensagens.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n');
  const u = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provedor.modelo)}:generateContent?key=${encodeURIComponent(chave)}`;
  const resp = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: sistema }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature } }) });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados?.error?.message || `Gemini respondeu ${resp.status}`);
  return { texto: dados?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '', uso: dados.usageMetadata || {} };
}

async function chamarOllama(mensagens, { sistema, maxTokens, temperatura, provedor, chave }) {
  const base = String(chave || '').replace(/\/$/, '');
  const resp = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: provedor.modelo, stream: false, options: { num_predict: maxTokens, temperature }, messages: [{ role: 'system', content: sistema }, ...mensagens] }) });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados?.error || `Ollama respondeu ${resp.status}`);
  return { texto: dados?.message?.content || '', uso: { prompt_eval_count: dados.prompt_eval_count, eval_count: dados.eval_count } };
}

async function chamar(mensagens, { sistema, maxTokens = 8000, temperatura = 0, provedorId = null, fallback = true } = {}) {
  const cfg = config();
  const escolhido = cfg.provedores.find((p) => p.id === provedorId && p.ativo) || cfg.provedores.find((p) => p.id === cfg.provedorPrincipal);
  const candidatos = fallback && escolhido ? [escolhido, ...cfg.provedores.filter((p) => p.ativo && p.id !== escolhido.id)] : [escolhido].filter(Boolean);
  if (!candidatos.length) throw new Error('Nenhuma IA configurada. Defina ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY, GROQ_API_KEY ou OLLAMA_BASE_URL.');
  const falhas = [];
  for (const provedor of candidatos) {
    try {
      const chave = chaveDoProvedor(provedor.id, db.prepare('SELECT * FROM ia_config WHERE id=1').get() || {});
      const args = { sistema, maxTokens, temperatura, provedor, chave };
      const r = provedor.id === 'anthropic' ? await chamarAnthropic(mensagens, args)
        : provedor.id === 'openai' || provedor.id === 'groq' ? await chamarOpenAiCompativel(mensagens, args)
          : provedor.id === 'gemini' ? await chamarGemini(mensagens, args) : await chamarOllama(mensagens, args);
      return { ...r, provedor: provedor.id, modelo: provedor.modelo, falhas };
    } catch (e) { falhas.push({ provedor: provedor.id, erro: e.message }); if (!fallback) throw e; }
  }
  throw new Error(`Nenhuma IA respondeu: ${falhas.map((f) => `${f.provedor}: ${f.erro}`).join(' | ')}`);
}

// --------------------------------------------------------------------------
// 1. LEITURA DO DOCUMENTO
// --------------------------------------------------------------------------
const TIPOS_IMAGEM = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function classificar(nomeArquivo, mimetype) {
  const ext = String(nomeArquivo || '').toLowerCase().slice(String(nomeArquivo).lastIndexOf('.'));
  if (mimetype === 'application/pdf' || ext === '.pdf') return { tipo: 'pdf', mime: 'application/pdf' };
  if (TIPOS_IMAGEM[ext] || String(mimetype || '').startsWith('image/')) return { tipo: 'imagem', mime: TIPOS_IMAGEM[ext] || mimetype };
  return { tipo: 'texto', mime: 'text/plain' };
}

const PROMPT_LEITURA = `Você transcreve documentos contratuais. Devolva o texto integral do documento, preservando a numeração de cláusulas, títulos, incisos, parágrafos, tabelas (em texto) e assinaturas.

Regras:
- Não resuma, não interprete, não comente. Apenas transcreva.
- Mantenha a ordem original e a estrutura hierárquica das cláusulas.
- Se alguma parte estiver ilegível, escreva [ilegível] no lugar.
- Não invente conteúdo que não esteja no documento.
- Devolva apenas o texto transcrito, sem introdução nem conclusão.`;

/** Extrai o texto de um arquivo enviado (PDF, imagem ou texto). */
async function extrairTexto(arquivo) {
  const { tipo, mime } = classificar(arquivo.originalname, arquivo.mimetype);
  if (tipo === 'texto') {
    return { texto: arquivo.buffer.toString('utf8'), tipo, viaIA: false };
  }
  const b64 = arquivo.buffer.toString('base64');
  const bloco = tipo === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };

  const r = await chamar([{ role: 'user', content: [bloco, { type: 'text', text: 'Transcreva integralmente este documento.' }] }],
    { sistema: PROMPT_LEITURA, maxTokens: 16000 });
  return { texto: r.texto, tipo, viaIA: true, uso: r.uso };
}

// --------------------------------------------------------------------------
// 2. ANÁLISE COM RAG
// --------------------------------------------------------------------------
const PROMPT_ANALISE = `Você é especialista em direito tributário brasileiro e na reforma da tributação sobre o consumo (EC 132/2023 e LC 214/2025), atuando pela Sattva Controladoria na revisão contratual de clientes.

Sua tarefa: analisar o contrato fornecido sob a ótica da reforma tributária e apontar, cláusula a cláusula, o que protege e o que expõe o cliente durante a transição 2026-2033.

Regras de trabalho:
- Fundamente-se nos TRECHOS DA BASE DE CONHECIMENTO fornecidos. Cite o marcador da fonte (ex.: F1, F3) no campo "fundamento" sempre que usar um trecho.
- Quando o contrato for silente sobre um ponto, diga que é silente. Não invente cláusula que não existe.
- Ao citar o contrato, transcreva o trecho exato, curto, no campo "trecho". Se não houver trecho, deixe vazio.
- Redija a cláusula sugerida em português jurídico, pronta para inserção, adaptada ao objeto e às partes deste contrato específico (use os nomes e o vocabulário do próprio contrato).
- Seja direto e específico. Nada de recomendações genéricas.

Responda EXCLUSIVAMENTE com um JSON válido, sem markdown, sem crases, no formato:
{
  "resumo": "2 a 4 frases sobre o contrato e a exposição dele à reforma",
  "tipo_contrato": "compra | fornecimento | venda | servico",
  "partes": {"contratante": "", "contratado": ""},
  "objeto": "",
  "vigencia": "",
  "preco_com_tributo_incluso": true,
  "risco_geral": "alto | medio | baixo",
  "achados": [
    {
      "clausula_id": "id da lista de referência, ou null se for ponto fora da lista",
      "titulo": "nome do ponto analisado",
      "situacao": "ausente | parcial | adequada | na",
      "risco": "alto | medio | baixo",
      "trecho": "transcrição literal do contrato, ou vazio",
      "analise": "por que isso importa neste contrato",
      "fundamento": "F1, F2",
      "sugestao": "texto da cláusula pronto para inserir"
    }
  ],
  "acoes": [
    {"titulo": "", "prioridade": "alta | media | baixa", "descricao": ""}
  ]
}`;

/**
 * Analisa o texto de um contrato.
 * @param {string} textoContrato
 * @param {object} ctx { empresa, contrato }
 */
async function analisarContrato(textoContrato, ctx = {}) {
  const texto = String(textoContrato || '').trim();
  if (texto.length < 200) throw new Error('O texto do contrato ficou muito curto para análise. Verifique se o arquivo foi lido corretamente.');

  // Recupera fundamentos na base de conhecimento
  const consultas = [
    'cláusula de preço tributos inclusos destaque IBS CBS',
    'reequilíbrio econômico-financeiro alteração legislação tributária',
    'crédito IBS CBS fornecedor Simples Nacional destaque documento fiscal',
    'split payment retenção liquidação financeira pagamento',
    'contrato longa duração transição regimes 2026 2033 reajuste',
    'classificação fiscal NCM NBS cClassTrib responsabilidade glosa',
    texto.slice(0, 1500),
  ];
  if (ctx.contrato && ctx.contrato.objeto) consultas.push(ctx.contrato.objeto);
  const contexto = rag.montarContexto(consultas);

  const referencia = CLAUSULAS.map((c) => `- ${c.id}: ${c.titulo} (risco ${c.risco}; aplica-se a ${c.aplicacao.join(', ')})`).join('\n');

  const limite = 90000; // caracteres — contratos maiores são truncados com aviso
  const truncado = texto.length > limite;
  const corpo = truncado ? texto.slice(0, limite) : texto;

  const mensagem = `## LISTA DE REFERÊNCIA DE CLÁUSULAS (use estes ids em "clausula_id")
${referencia}

## TRECHOS DA BASE DE CONHECIMENTO
${contexto.texto || '(base de conhecimento vazia — analise apenas com conhecimento técnico geral e informe isso no resumo)'}

## CONTEXTO DO CLIENTE
${ctx.empresa ? `Empresa: ${ctx.empresa.razao_social} — regime ${ctx.empresa.regime}${ctx.empresa.uf ? `, ${ctx.empresa.uf}` : ''}` : 'não informado'}
${ctx.contrato ? `Cadastro do contrato: tipo ${ctx.contrato.tipo}, contraparte ${ctx.contrato.contraparte || '—'}, regime da contraparte ${ctx.contrato.regime_contraparte || '—'}, valor ${ctx.contrato.valor || 0}` : ''}

## CONTRATO A ANALISAR
${corpo}${truncado ? '\n\n[DOCUMENTO TRUNCADO — analise o trecho disponível e registre essa limitação no resumo]' : ''}`;

  const r = await chamar([{ role: 'user', content: mensagem }], { sistema: PROMPT_ANALISE, maxTokens: 12000 });

  let json;
  try {
    const limpo = r.texto.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
    json = JSON.parse(limpo.slice(limpo.indexOf('{'), limpo.lastIndexOf('}') + 1));
  } catch (e) {
    throw new Error('A IA respondeu em formato inesperado. Tente novamente; se persistir, reduza o tamanho do documento.');
  }
  return { analise: json, fontes: contexto.trechos, uso: r.uso, truncado, caracteres: texto.length };
}

/** Pergunta livre sobre a base de conhecimento (consulta técnica). */
async function perguntar(pergunta, ctx = {}) {
  const contexto = rag.montarContexto([pergunta], 6, 12);
  if (!contexto.texto) throw new Error('A base de conhecimento está vazia. Adicione documentos antes de consultar.');
  const r = await chamar([{ role: 'user', content: `## BASE DE CONHECIMENTO\n${contexto.texto}\n\n## PERGUNTA\n${pergunta}` }], {
    sistema: `Você é especialista em reforma tributária brasileira, respondendo a consultores da Sattva Controladoria.
Responda com base nos trechos fornecidos, citando os marcadores das fontes (F1, F2...) ao longo do texto.
Se os trechos não cobrirem a pergunta, diga claramente o que falta na base em vez de inventar.
Seja direto e técnico. Sem introduções longas.`, maxTokens: 3000, temperatura: 0.2 });
  return { resposta: r.texto, fontes: contexto.trechos };
}

module.exports = { config, salvarConfig, chamar, extrairTexto, analisarContrato, perguntar, classificar };

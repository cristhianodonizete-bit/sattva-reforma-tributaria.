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

function config() {
  const row = db.prepare('SELECT * FROM ia_config WHERE id = 1').get() || {};
  return {
    chave: process.env.ANTHROPIC_API_KEY || row.api_key || '',
    modelo: row.modelo || process.env.ANTHROPIC_MODELO || 'claude-sonnet-5',
    ativo: !!(process.env.ANTHROPIC_API_KEY || row.api_key),
    origemChave: process.env.ANTHROPIC_API_KEY ? 'variável de ambiente' : (row.api_key ? 'configuração do sistema' : 'não configurada'),
  };
}

function salvarConfig({ api_key, modelo }) {
  db.prepare(`UPDATE ia_config SET api_key = ?, modelo = ?, atualizado_em = datetime('now','localtime') WHERE id = 1`)
    .run(api_key === undefined ? (db.prepare('SELECT api_key FROM ia_config WHERE id=1').get() || {}).api_key || '' : api_key,
      modelo || 'claude-sonnet-5');
  return config();
}

async function chamar(mensagens, { sistema, maxTokens = 8000, temperatura = 0 } = {}) {
  const cfg = config();
  if (!cfg.chave) {
    throw new Error('Chave da API não configurada. Informe a ANTHROPIC_API_KEY no arquivo .env ou na tela "Base de conhecimento".');
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180000);
  try {
    const resp = await fetch(API, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.chave, 'anthropic-version': VERSAO },
      body: JSON.stringify({ model: cfg.modelo, max_tokens: maxTokens, temperature: temperatura,
        system: sistema, messages: mensagens }),
    });
    const texto = await resp.text();
    let dados; try { dados = JSON.parse(texto); } catch (_) { dados = null; }
    if (!resp.ok) {
      const msg = dados && dados.error ? dados.error.message : texto.slice(0, 300);
      if (resp.status === 401) throw new Error('Chave da API rejeitada (401). Confira a ANTHROPIC_API_KEY.');
      if (resp.status === 429) throw new Error('Limite de requisições atingido (429). Aguarde alguns instantes e tente de novo.');
      throw new Error(`API respondeu ${resp.status}: ${msg}`);
    }
    const conteudo = (dados.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { texto: conteudo, uso: dados.usage || {} };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Tempo esgotado na chamada à IA. Documentos muito longos podem exigir divisão em partes.');
    throw e;
  } finally { clearTimeout(t); }
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

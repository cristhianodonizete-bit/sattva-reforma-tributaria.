/**
 * Contratos — Entrega 1
 *
 * Esta camada é deliberadamente determinística. Ela extrai trechos do texto
 * original e aponta riscos iniciais somente por evidência literal ou ausência
 * objetiva de um tema. Não redige cláusulas e não calcula tributos.
 */
const crypto = require('crypto');
const zlib = require('zlib');

const TEMAS = [
  ['preco', /\b(preço|preco|valor|remuneração|remuneracao|contraprestação|contraprestacao)\b/i],
  ['tributos', /\b(tributo|tributári|tributari|imposto|cbs|ibs|pis|cofins|icms|iss)\b/i],
  ['repasse_tributario', /\b(repasse|repassar|transferir.{0,24}(tribut|impost|encargo))\b/i],
  ['alteracao_legislativa', /\b(alteraç|alterac|legislaç|legislac|reforma tributária|reforma tributaria|cbs|ibs)\b/i],
  ['reajuste', /\b(reajuste|reajust|ipca|igp[- ]?m|índice|indice)\b/i],
  ['reequilibrio', /\b(reequilíbrio|reequilibrio|equilíbrio econômico|equilibrio economico)\b/i],
  ['responsabilidade_tributaria', /\b(responsabil.{0,40}(tribut|impost)|tribut.{0,40}responsabil|respond.{0,40}(tribut|impost)|(?:tribut|impost).{0,40}respond)\b/i],
  ['retencoes', /\b(retenç|retenc|retenção|retencao)\b/i],
  ['gross_up', /\b(gross[- ]?up)\b/i],
  ['credito_tributario', /\b(crédito tributário|credito tributario|apropriaç.{0,30}crédito|apropriac.{0,30}credito)\b/i],
  ['faturamento', /\b(faturamento|cobrança|cobranca|fatura)\b/i],
  ['documento_fiscal', /\b(nota fiscal|documento fiscal|nf-?e|nota de serviço|nota de servico)\b/i],
  ['prazo', /\b(prazo|vigência|vigencia)\b/i],
  ['renovacao', /\b(renovaç|renovac|renovar|prorrogaç|prorrogac)\b/i],
  ['rescisao', /\b(rescisão|rescisao|rescindir)\b/i],
];

const n = (v) => String(v || '').replace(/\r\n?/g, '\n').trim();
const tem = (clausulas, tema) => clausulas.some((c) => c.tema === tema);
const porTema = (clausulas, tema) => clausulas.filter((c) => c.tema === tema);

function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function separarTrechos(texto) {
  const blocos = n(texto).split(/\n\s*\n|(?=\n\s*(?:CL[ÁA]USULA|Cl[áa]usula|\d+(?:\.\d+)*[.)]))/).map(n).filter(Boolean);
  return (blocos.length ? blocos : [n(texto)]).map((texto_original, i) => ({
    ordem: i + 1,
    texto_original,
    localizacao: `texto — trecho ${i + 1}`,
    secao: (texto_original.match(/^\s*(CL[ÁA]USULA\s+[^\n]+|\d+(?:\.\d+)*[.)][^\n]*)/i) || [])[1] || null,
  }));
}

function extrairClausulas(texto) {
  const clausulas = [];
  for (const trecho of separarTrechos(texto)) {
    const temas = TEMAS.filter(([, re]) => re.test(trecho.texto_original)).map(([tema]) => tema);
    for (const tema of temas) clausulas.push({ ...trecho, tema, confianca: 1, natureza: 'EXTRAIDO' });
  }
  return clausulas;
}

function risco(codigo, risco, evidencia, impacto_potencial, nivel, fundamento, clausula_ordem = null) {
  return { codigo, risco, evidencia, impacto_potencial, nivel, fundamento, clausula_ordem, natureza: 'INTERPRETADO', status: 'ABERTO' };
}

function riscosIniciais(clausulas) {
  const riscos = [];
  const textoTema = (tema) => porTema(clausulas, tema)[0];
  const tributaria = textoTema('tributos');
  const preco = textoTema('preco');
  const reajuste = textoTema('reajuste');
  const reequilibrio = textoTema('reequilibrio');
  const legislacao = textoTema('alteracao_legislativa');
  const repasse = textoTema('repasse_tributario');
  const responsabilidade = textoTema('responsabilidade_tributaria');
  const retencoes = textoTema('retencoes');
  const legado = clausulas.find((c) => /\b(pis|cofins|icms|iss)\b/i.test(c.texto_original));
  const transicao = clausulas.find((c) => /\b(cbs|ibs|reforma tribut)/i.test(c.texto_original));
  const fixo = porTema(clausulas, 'preco').find((c) => /\b(fixo|irreajustável|irreajustavel|sem reajuste)\b/i.test(c.texto_original));

  if (!tributaria) riscos.push(risco('AUSENCIA_CLAUSULA_TRIBUTARIA', 'Ausência de cláusula tributária',
    'Ausência objetiva: nenhum trecho extraído contém tema tributário.', 'A alocação de efeitos tributários não está expressa no documento.', 'alto', 'Verificação objetiva dos temas extraídos.'));
  if (tributaria && !repasse && !reequilibrio && !legislacao) riscos.push(risco('CLAUSULA_TRIBUTARIA_GENERICA', 'Cláusula tributária potencialmente genérica',
    `Trecho ${tributaria.ordem}: ${tributaria.texto_original.slice(0, 280)}`, 'O texto encontrado não explicita repasse, reequilíbrio ou gatilho legislativo.', 'medio', 'Comparação objetiva entre temas extraídos.', tributaria.ordem));
  if (fixo && !reajuste && !reequilibrio) riscos.push(risco('PRECO_FIXO_SEM_REVISAO', 'Preço fixo sem mecanismo de revisão identificado',
    `Trecho ${fixo.ordem}: ${fixo.texto_original.slice(0, 280)}`, 'Pode concentrar na parte contratada o efeito econômico de alterações futuras.', 'alto', 'Preço fixo identificado sem tema de reajuste ou reequilíbrio.', fixo.ordem));
  if ((preco || tributaria) && !legislacao) riscos.push(risco('SEM_GATILHO_ALTERACAO_LEGAL', 'Sem gatilho de alteração legislativa identificado',
    'Ausência objetiva: há tema de preço ou tributos, sem trecho sobre alteração legislativa.', 'Alterações normativas podem não ter procedimento contratual expresso.', 'medio', 'Verificação objetiva dos temas extraídos.'));
  if (fixo && !repasse) riscos.push(risco('POTENCIAL_ABSORCAO_AUMENTO', 'Potencial absorção de aumento tributário',
    `Trecho ${fixo.ordem}: ${fixo.texto_original.slice(0, 280)}`, 'O contrato não apresenta, no texto extraído, mecanismo de repasse associado ao preço fixo.', 'alto', 'Preço fixo identificado sem tema de repasse tributário.', fixo.ordem));
  if (!responsabilidade && tributaria) riscos.push(risco('RESPONSABILIDADE_TRIBUTARIA_INDEFINIDA', 'Responsabilidade tributária não explicitada',
    'Ausência objetiva: há cláusula tributária, sem tema de responsabilidade tributária.', 'Pode haver dúvida operacional sobre obrigações e classificação fiscal.', 'medio', 'Verificação objetiva dos temas extraídos.'));
  if (retencoes && !responsabilidade) riscos.push(risco('RETENCOES_SEM_RESPONSABILIDADE', 'Retenções sem responsabilidade correlata identificada',
    `Trecho ${retencoes.ordem}: ${retencoes.texto_original.slice(0, 280)}`, 'O procedimento de retenções pode não indicar claramente a responsabilidade entre as partes.', 'medio', 'Tema de retenções sem tema de responsabilidade tributária.', retencoes.ordem));
  if (legado && !transicao) riscos.push(risco('TRIBUTOS_LEGADOS_SEM_TRANSICAO', 'Referência a tributos atuais sem transição identificada',
    `Trecho ${legado.ordem}: ${legado.texto_original.slice(0, 280)}`, 'O texto menciona tributos atuais sem referência identificada a IBS, CBS ou reforma tributária.', 'medio', 'Verificação literal de tributos legados e temas de transição.', legado.ordem));
  return riscos;
}

function analisarTexto(texto) {
  const clausulas = extrairClausulas(texto);
  return { texto: n(texto), clausulas, riscos: riscosIniciais(clausulas), versao: 'CONTRATOS_ENTREGA_1_V1' };
}

// DOCX é um arquivo ZIP. Esta leitura extrai apenas document.xml com a
// biblioteca padrão do Node; não modifica nem regrava o arquivo original.
function textoDocx(buffer) {
  const b = Buffer.from(buffer);
  for (let i = b.length - 22; i >= 0; i -= 1) {
    if (b.readUInt32LE(i) !== 0x06054b50) continue;
    const total = b.readUInt16LE(i + 10); let p = b.readUInt32LE(i + 16);
    for (let nEntry = 0; nEntry < total; nEntry += 1) {
      if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('DOCX inválido: diretório ZIP não reconhecido.');
      const metodo = b.readUInt16LE(p + 10), comprimido = b.readUInt32LE(p + 20);
      const nomeTamanho = b.readUInt16LE(p + 28), extraTamanho = b.readUInt16LE(p + 30), comentarioTamanho = b.readUInt16LE(p + 32);
      const nome = b.subarray(p + 46, p + 46 + nomeTamanho).toString('utf8'); const local = b.readUInt32LE(p + 42);
      if (nome === 'word/document.xml') {
        if (b.readUInt32LE(local) !== 0x04034b50) throw new Error('DOCX inválido: conteúdo não reconhecido.');
        const nomeLocal = b.readUInt16LE(local + 26), extraLocal = b.readUInt16LE(local + 28);
        const dados = b.subarray(local + 30 + nomeLocal + extraLocal, local + 30 + nomeLocal + extraLocal + comprimido);
        const xml = (metodo === 0 ? dados : metodo === 8 ? zlib.inflateRawSync(dados) : null);
        if (!xml) throw new Error('DOCX usa compactação não suportada.');
        return xml.toString('utf8').replace(/<w:tab[^>]*\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      }
      p += 46 + nomeTamanho + extraTamanho + comentarioTamanho;
    }
  }
  throw new Error('DOCX inválido: word/document.xml não encontrado.');
}

async function extrairArquivo(arquivo, { extrairPdf } = {}) {
  const nome = String(arquivo.originalname || '').toLowerCase(); const buffer = Buffer.from(arquivo.buffer || []);
  if (!buffer.length) throw new Error('Arquivo sem conteúdo.');
  if (/\.(txt|md|csv)$/i.test(nome) || String(arquivo.mimetype || '').startsWith('text/')) return { texto: buffer.toString('utf8'), tipo: 'TEXTO', status: 'CONCLUIDA', observacao: '' };
  if (/\.docx$/i.test(nome)) return { texto: textoDocx(buffer), tipo: 'DOCX', status: 'CONCLUIDA', observacao: '' };
  if (/\.pdf$/i.test(nome)) {
    if (!extrairPdf) return { texto: '', tipo: 'PDF', status: 'PENDENTE_LEITURA', observacao: 'PDF original preservado. Leitura estruturada indisponível neste ambiente.' };
    const texto = await extrairPdf(arquivo);
    return { texto, tipo: 'PDF', status: 'CONCLUIDA', observacao: 'Texto extraído para rastreabilidade; arquivo original preservado.' };
  }
  throw new Error('Formato não suportado. Envie PDF, DOCX ou TXT, ou informe o texto manualmente.');
}

module.exports = { hash, analisarTexto, extrairClausulas, riscosIniciais, extrairArquivo, textoDocx };

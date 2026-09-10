/*
 * Extrator local de texto para o PGDAS-D. PDFs digitais do portal possuem
 * camada textual; portanto o documento fiscal não precisa sair do backend.
 * OCR é deliberadamente responsabilidade de um fallback futuro.
 */
const { PDFParse } = require('pdf-parse');

async function extrair(arquivo) {
  // better-sqlite3/SQLite devolve BLOB restaurado como Uint8Array em algumas
  // versões do Node. O conteúdo existe (e vem do bytea do Supabase), mas não
  // satisfaz Buffer.isBuffer. Normalizar aqui evita que um PDF durável seja
  // incorretamente reportado como ausente após reinício do Render.
  const buffer=Buffer.isBuffer(arquivo?.buffer) ? arquivo.buffer
    : arquivo?.buffer instanceof Uint8Array ? Buffer.from(arquivo.buffer)
      : null;
  if (!buffer?.length) throw new Error('Arquivo PDF ausente para extração local.');
  if (!buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('O arquivo informado não é um PDF válido.');
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
    const resultado = await parser.getText();
    const texto = String(resultado?.text || '').trim();
    if (!texto) throw new Error('TEXT_EXTRACTION_FAILED');
    return {
      texto,
      localizacoes: [],
      modelo: 'NATIVE_PDF_TEXT_V1',
      paginas: Number(resultado?.total || 0),
    };
  } catch (e) {
    const erro = new Error(`TEXT_EXTRACTION_FAILED: ${e.message || e}`);
    erro.code = 'TEXT_EXTRACTION_FAILED';
    throw erro;
  } finally {
    await parser?.destroy?.();
  }
}

module.exports = { extrair };

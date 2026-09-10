/*
 * Extrator local de texto para o PGDAS-D. PDFs digitais do portal possuem
 * camada textual; portanto o documento fiscal não precisa sair do backend.
 * OCR é deliberadamente responsabilidade de um fallback futuro.
 */
const { PDFParse } = require('pdf-parse');

async function extrair(arquivo) {
  if (!arquivo?.buffer || !Buffer.isBuffer(arquivo.buffer)) throw new Error('Arquivo PDF ausente para extração local.');
  if (!arquivo.buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('O arquivo informado não é um PDF válido.');
  let parser;
  try {
    parser = new PDFParse({ data: arquivo.buffer });
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

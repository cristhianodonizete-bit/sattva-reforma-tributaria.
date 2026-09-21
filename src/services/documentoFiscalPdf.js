const crypto = require('crypto');
const { PDFParse } = require('pdf-parse');

const texto = (valor) => String(valor || '').replace(/\s+/g, ' ').trim();
const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '');
const numero = (valor) => {
  const limpo = String(valor || '').replace(/R\$|\s/g, '').replace(/[^0-9,.-]/g, '');
  if (!limpo) return null;
  const convertido = Number(limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo);
  return Number.isFinite(convertido) ? convertido : null;
};

function capturar(textoPdf, padrao, grupo = 1) {
  const encontrado = textoPdf.match(padrao);
  return encontrado?.[grupo] ? texto(encontrado[grupo]) : null;
}

function extrairIdentidade(textoPdf) {
  const chave = somenteDigitos(capturar(textoPdf, /chave\s+de\s+acesso\D*([0-9\s.-]{44,70})/i));
  const cnpj = somenteDigitos(capturar(textoPdf, /(?:CNPJ|CPF\/CNPJ)\D*([0-9.\-/]{14,22})/i));
  const serie = somenteDigitos(capturar(textoPdf, /s[ée]rie\D{0,20}(\d{1,8})/i));
  const documento = somenteDigitos(capturar(textoPdf, /(?:n[uú]mero|n[ºo]|nota\s+fiscal)\D{0,25}(\d{1,12})/i));
  const data = capturar(textoPdf, /(?:data\s+de\s+emiss[aã]o|emiss[aã]o)\D{0,20}(\d{2}\/\d{2}\/\d{4})/i);
  const totalBruto = capturar(textoPdf, /(?:valor\s+total(?:\s+da\s+nota)?|valor\s+a\s+pagar)\D{0,30}(R?\$?\s*[\d.]+,\d{2})/i);
  return {
    chave: chave.length === 44 ? chave : null,
    cnpj: cnpj.length === 14 ? cnpj : null,
    serie: serie || null,
    documento: documento || null,
    data_emissao: data ? `${data.slice(6)}-${data.slice(3, 5)}-${data.slice(0, 2)}` : null,
    valor_total: numero(totalBruto),
  };
}

async function analisar(arquivo) {
  const buffer = Buffer.isBuffer(arquivo?.buffer) ? arquivo.buffer : Buffer.from(arquivo?.buffer || []);
  if (!buffer.length || !buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) {
    throw new Error('O arquivo não é um PDF válido.');
  }
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
    const resultado = await parser.getText();
    const textoPdf = texto(resultado?.text);
    const identidade = extrairIdentidade(textoPdf);
    return {
      hash_sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      paginas: Number(resultado?.total || 0),
      texto_extraido: textoPdf.slice(0, 12000),
      identidade,
      metodo_extracao: textoPdf ? 'PDF_TEXTO_NATIVO_V1' : 'PDF_SEM_CAMADA_TEXTUAL',
      status: textoPdf ? 'AGUARDANDO_XML_OU_CONFIRMACAO' : 'REQUER_OCR_OU_CONFIRMACAO',
    };
  } catch (erro) {
    if (erro?.message === 'O arquivo não é um PDF válido.') throw erro;
    return {
      hash_sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      paginas: 0,
      texto_extraido: '',
      identidade: { chave: null, cnpj: null, serie: null, documento: null, data_emissao: null, valor_total: null },
      metodo_extracao: 'PDF_SEM_CAMADA_TEXTUAL',
      status: 'REQUER_OCR_OU_CONFIRMACAO',
    };
  } finally {
    await parser?.destroy?.();
  }
}

module.exports = { analisar, extrairIdentidade };

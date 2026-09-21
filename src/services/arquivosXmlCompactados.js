const unzipper = require('unzipper');
const { createExtractorFromData } = require('node-unrar-js');

// Pastas selecionadas no navegador já seguem em blocos de 500. O ZIP/RAR,
// porém, chega como um único arquivo e antes era recusado a partir de 2 mil
// XMLs, obrigando o usuário a quebrar manualmente o mesmo acervo. O teto
// maior atende arquivos fiscais reais; os limites de bytes continuam sendo a
// defesa contra descompressão excessiva.
const LIMITE_ARQUIVOS_XML = 10000;
const LIMITE_TOTAL_DESCOMPACTADO = 150 * 1024 * 1024;
const LIMITE_XML_INDIVIDUAL = 20 * 1024 * 1024;

const nomeSeguro = (nome) => {
  const texto = String(nome || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!texto || texto.split('/').some((parte) => parte === '..')) return null;
  return texto;
};
const extensao = (nome) => String(nome || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
const xml = (nome) => extensao(nome) === 'xml';

function validarTamanho(tamanho, nome) {
  if (Number(tamanho || 0) > LIMITE_XML_INDIVIDUAL) throw new Error(`${nome}: XML excede o limite de 20 MB.`);
}

function incluir(saida, arquivo, nome) {
  const caminho = nomeSeguro(nome);
  if (!caminho || !xml(caminho)) return false;
  validarTamanho(arquivo.length, caminho);
  saida.push({ originalname:caminho, buffer:Buffer.from(arquivo), mimetype:'application/xml' });
  if (saida.length > LIMITE_ARQUIVOS_XML) throw new Error(`Arquivo compactado excede o limite de ${LIMITE_ARQUIVOS_XML} XMLs por envio.`);
  return true;
}

async function abrirZip(arquivo, saida) {
  const diretorio = await unzipper.Open.buffer(arquivo.buffer);
  let total = 0;
  for (const entrada of diretorio.files) {
    if (entrada.type !== 'File' || !xml(entrada.path)) continue;
    const tamanho = Number(entrada.uncompressedSize || 0);
    validarTamanho(tamanho, entrada.path);
    total += tamanho;
    if (total > LIMITE_TOTAL_DESCOMPACTADO) throw new Error(`${arquivo.originalname}: conteúdo descompactado excede 150 MB.`);
    incluir(saida, await entrada.buffer(), `${arquivo.originalname}/${entrada.path}`);
  }
}

async function abrirRar(arquivo, saida) {
  const extrator = await createExtractorFromData({ data: new Uint8Array(arquivo.buffer) });
  const lista = extrator.getFileList();
  const cabecalhos = [...lista.fileHeaders].filter((x) => !x.flags?.directory && xml(x.name));
  let total = 0;
  for (const cabecalho of cabecalhos) {
    const tamanho = Number(cabecalho.unpSize || 0);
    validarTamanho(tamanho, cabecalho.name);
    total += tamanho;
    if (total > LIMITE_TOTAL_DESCOMPACTADO) throw new Error(`${arquivo.originalname}: conteúdo descompactado excede 150 MB.`);
  }
  const extraidos = extrator.extract({ files: cabecalhos.map((x) => x.name) });
  for (const item of [...extraidos.files]) {
    if (item.fileHeader.flags?.directory || !xml(item.fileHeader.name)) continue;
    incluir(saida, item.extraction, `${arquivo.originalname}/${item.fileHeader.name}`);
  }
}

async function preparar(arquivosEnviados = []) {
  const arquivos = [];
  const estatistica = { enviados:arquivosEnviados.length, xml_diretos:0, compactados:0, xml_extraidos:0, ignorados:0 };
  for (const arquivo of arquivosEnviados) {
    const tipo = extensao(arquivo.originalname);
    if (tipo === 'xml') {
      incluir(arquivos, arquivo.buffer, arquivo.originalname);
      estatistica.xml_diretos++;
    } else if (tipo === 'zip') {
      const antes = arquivos.length;
      await abrirZip(arquivo, arquivos);
      estatistica.compactados++; estatistica.xml_extraidos += arquivos.length - antes;
    } else if (tipo === 'rar') {
      const antes = arquivos.length;
      await abrirRar(arquivo, arquivos);
      estatistica.compactados++; estatistica.xml_extraidos += arquivos.length - antes;
    } else estatistica.ignorados++;
  }
  if (!arquivos.length) throw new Error('Nenhum XML foi encontrado nos arquivos enviados. Use XML, ZIP ou RAR contendo XMLs fiscais.');
  return { arquivos, estatistica };
}

module.exports = { preparar, LIMITE_ARQUIVOS_XML, LIMITE_TOTAL_DESCOMPACTADO };

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const XLSX = require('xlsx');

const DOMINIOS = Object.freeze({ CST: 'CST_IBS_CBS', CCLASSTRIB: 'CCLASSTRIB_IBS_CBS' });
const CAMPOS_CST = Object.freeze([
  'Cst', 'NomeCst', 'IndExigeTrib', 'IndMonofasica', 'IndReducaoAliq', 'IndDiferimento',
  'IndReducaoBc', 'IndTransferenciaCred', 'IndCredPresIbsZfm', 'IndAjusteCompet', 'ClassificacoesTributarias'
]);
const CAMPOS_CCLASSTRIB = Object.freeze([
  'CodClassTrib', 'Cst', 'NomeClassTrib', 'PercRedIbs', 'PercRedCbs', 'DthPublicacao',
  'DthIniVig', 'IndTribRegular', 'IndPermiteCredPres', 'IndMonoVal', 'IndMonoRetem',
  'IndMonoRet', 'IndMonoDif', 'IndEstornoCred', 'TipoAliq', 'TipoRbSn'
]);

class CffErro extends Error {
  constructor(codigo, mensagem, detalhes = {}) {
    super(mensagem);
    this.name = 'CffErro';
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === 'object') return Object.keys(valor).sort().reduce((acc, chave) => {
    acc[chave] = canonico(valor[chave]);
    return acc;
  }, {});
  return valor;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonico(payload))).digest('hex');
}

function dataIso(valor) {
  if (!valor || typeof valor !== 'string') return null;
  const encontrada = valor.match(/^\d{4}-\d{2}-\d{2}/);
  return encontrada ? encontrada[0] : null;
}

function criarAgenteCertificado(env = process.env) {
  const caminho = env.CFF_CERT_PATH;
  const pfxBase64 = env.CFF_CERT_PFX_BASE64;
  if (!caminho && !pfxBase64) throw new CffErro('CFF_CERT_CONFIG_MISSING', 'Certificado CFF não configurado.');
  const pfx = pfxBase64 ? Buffer.from(pfxBase64, 'base64') : fs.readFileSync(caminho);
  return new https.Agent({ pfx, passphrase: env.CFF_CERT_PASSWORD || undefined, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
}

function requisitarHttps({ url, agent, timeoutMs = 15000, request = https.request }) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', agent, timeout: timeoutMs, headers: { accept: 'application/json' } }, (res) => {
      const partes = [];
      res.on('data', (parte) => partes.push(parte));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new CffErro('CFF_TIMEOUT', 'Tempo de consulta CFF excedido.')));
    req.on('error', reject);
    req.end();
  });
}

async function consultarCff({ env = process.env, request, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)), tentativas = 3 } = {}) {
  const url = env.CFF_BASE_URL || 'https://cff.svrs.rs.gov.br/api/v1/consultas/classTrib';
  const agent = criarAgenteCertificado(env);
  let ultima;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      const resposta = await requisitarHttps({ url, agent, request });
      if (resposta.status === 401 || resposta.status === 403) throw new CffErro(`CFF_HTTP_${resposta.status}`, 'Autenticação CFF recusada.', { status: resposta.status });
      if (resposta.status === 429 || resposta.status >= 500) {
        ultima = new CffErro(`CFF_HTTP_${resposta.status}`, 'CFF indisponível temporariamente.', { status: resposta.status });
        if (tentativa < tentativas) { await sleep(100 * tentativa); continue; }
        throw ultima;
      }
      if (resposta.status < 200 || resposta.status >= 300) throw new CffErro(`CFF_HTTP_${resposta.status}`, 'Resposta CFF não aceita.', { status: resposta.status });
      try { return JSON.parse(resposta.body); } catch { throw new CffErro('CFF_JSON_INVALIDO', 'A resposta CFF não contém JSON válido.'); }
    } catch (erro) {
      if (/CERT|TLS|OSSL/i.test(erro.code || '')) throw new CffErro('CFF_CERT_INVALIDO', 'Certificado CFF inválido ou não confiável.');
      if (erro.code === 'ETIMEDOUT') erro = new CffErro('CFF_TIMEOUT', 'Tempo de consulta CFF excedido.');
      if (erro instanceof CffErro && !['CFF_TIMEOUT'].includes(erro.codigo)) throw erro;
      ultima = erro instanceof CffErro ? erro : new CffErro('CFF_REDE', 'Falha de rede ao consultar a CFF.');
      if (tentativa < tentativas) { await sleep(100 * tentativa); continue; }
    }
  }
  throw ultima || new CffErro('CFF_FALHA', 'Falha desconhecida na consulta CFF.');
}

function lerArquivoOficial(arquivo) {
  const extensao = String(arquivo).split('.').pop().toLowerCase();
  if (extensao === 'json') return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (extensao === 'xlsx' || extensao === 'xls' || extensao === 'csv') {
    const livro = XLSX.readFile(arquivo, { raw: true });
    const primeiraAba = livro.SheetNames[0];
    if (!primeiraAba) throw new CffErro('CFF_ARQUIVO_VAZIO', 'Arquivo oficial sem aba ou conteúdo.');
    return XLSX.utils.sheet_to_json(livro.Sheets[primeiraAba], { defval: null });
  }
  throw new CffErro('CFF_ARQUIVO_TIPO_NAO_SUPORTADO', 'Tipo de arquivo oficial não suportado.');
}

function prepararArquivoOficial({ arquivo, normalizar, origemOficial, endpoint = null, consultadoEm = new Date().toISOString() }) {
  if (!origemOficial) throw new CffErro('CFF_ORIGEM_NAO_COMPROVADA', 'Arquivo sem origem oficial comprovada.');
  const bruto = lerArquivoOficial(arquivo);
  const payload = Array.isArray(bruto) && typeof normalizar === 'function' ? normalizar(bruto) : bruto;
  return prepararConsultaAceita(payload, { endpoint: endpoint || `arquivo:${arquivo}`, consultadoEm });
}

function extrairCsts(payload) {
  const dados = Array.isArray(payload) ? payload : (payload?.dados || payload?.data || payload?.resultado);
  if (!Array.isArray(dados)) throw new CffErro('CFF_SCHEMA_RAIZ', 'A resposta CFF não contém a coleção oficial de CST.');
  return dados;
}

function validarCampos(objeto, obrigatorios, tipo) {
  const ausentes = obrigatorios.filter((campo) => !(campo in objeto));
  if (ausentes.length) throw new CffErro('CFF_SCHEMA_OBRIGATORIO_AUSENTE', `Campos obrigatórios ausentes em ${tipo}.`, { tipo, ausentes });
}

function validarSchema(payload) {
  const csts = extrairCsts(payload);
  const camposNovos = new Set();
  const cclass = [];
  csts.forEach((cst) => {
    validarCampos(cst, CAMPOS_CST, 'CST');
    if (!/^\d{3}$/.test(String(cst.Cst))) throw new CffErro('CFF_CST_INVALIDO', 'Código CST inválido.', { codigo: cst.Cst });
    Object.keys(cst).forEach((campo) => { if (!CAMPOS_CST.includes(campo)) camposNovos.add(`CST.${campo}`); });
    cst.ClassificacoesTributarias.forEach((linha) => {
      validarCampos(linha, CAMPOS_CCLASSTRIB, 'cClassTrib');
      if (!/^\d{6}$/.test(String(linha.CodClassTrib))) throw new CffErro('CFF_CCLASSTRIB_INVALIDO', 'Código cClassTrib inválido.', { codigo: linha.CodClassTrib });
      if (String(linha.Cst) !== String(cst.Cst)) throw new CffErro('CFF_RELACAO_INVALIDA', 'cClassTrib relacionado a CST divergente.', { cst: cst.Cst, cclasstrib: linha.CodClassTrib, cstInformado: linha.Cst });
      Object.keys(linha).forEach((campo) => { if (!CAMPOS_CCLASSTRIB.includes(campo)) camposNovos.add(`cClassTrib.${campo}`); });
      cclass.push(linha);
    });
  });
  const codigosCst = csts.map((x) => String(x.Cst));
  const codigosClass = cclass.map((x) => String(x.CodClassTrib));
  if (new Set(codigosCst).size !== codigosCst.length) throw new CffErro('CFF_CST_DUPLICADO', 'CST duplicado na mesma publicação.');
  if (new Set(codigosClass).size !== codigosClass.length) throw new CffErro('CFF_CCLASSTRIB_DUPLICADO', 'cClassTrib duplicado na mesma publicação.');
  const publicacoes = [...new Set(cclass.map((x) => dataIso(x.DthPublicacao)).filter(Boolean))];
  if (publicacoes.length !== 1) throw new CffErro('CFF_PUBLICACAO_AMBIGUA', 'A resposta CFF não possui uma única publicação identificável.', { publicacoes });
  return { csts, cclass, publicacao: publicacoes[0], camposNovos: [...camposNovos].sort() };
}

function prepararConsultaAceita(payload, { endpoint = 'https://cff.svrs.rs.gov.br/api/v1/consultas/classTrib', consultadoEm = new Date().toISOString() } = {}) {
  const schema = validarSchema(payload);
  return {
    origem: 'CFF_SVRS', endpoint, consultado_em: consultadoEm, hash_sha256: hashPayload(payload),
    publicacao: schema.publicacao, status_versao: 'RASCUNHO', payload_original: payload,
    campos_origem: { campos_novos_detectados: schema.camposNovos }, ...schema
  };
}

function decidirIdempotencia(existentes, consulta) {
  const mesmaPublicacao = (existentes || []).filter((x) => x.publicacao === consulta.publicacao || x.versao === consulta.publicacao);
  if (mesmaPublicacao.some((x) => x.hash_sha256 === consulta.hash_sha256 || x.arquivo_hash_sha256 === consulta.hash_sha256)) return { acao: 'IGNORAR_IDEMPOTENTE' };
  if (mesmaPublicacao.length) return { acao: 'REQUER_VALIDACAO', motivo: 'Mesma publicação oficial com hash diferente.' };
  return { acao: 'CRIAR_RASCUNHO' };
}

module.exports = { CffErro, CAMPOS_CST, CAMPOS_CCLASSTRIB, criarAgenteCertificado, consultarCff, lerArquivoOficial, prepararArquivoOficial, validarSchema, prepararConsultaAceita, decidirIdempotencia, hashPayload };

/*
 * Integra Contador — consulta somente leitura de PGDAS-D já transmitido.
 *
 * A contratação/credenciamento é feita fora do Sattva, junto ao Serpro ou ao
 * provedor homologado. Por isso URL, credenciais e o caminho contratado ficam
 * exclusivamente em variáveis de ambiente; nunca são enviados ao navegador ou
 * gravados no banco de dados da empresa.
 */
const https = require('https');
const apenasDigitos = (v) => String(v || '').replace(/\D/g, '');
const chave = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const numero = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/R\$|\s/g, '').replace(/[^0-9,.-]/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
};
const competencia = (v) => {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})[-/]?(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{2})[/-](\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : null;
};

function config(env = process.env) {
  const baseUrl = String(env.INTEGRA_CONTADOR_BASE_URL || '').trim().replace(/\/$/, '');
  const serproDireto = /apiserpro\.serpro\.gov\.br/i.test(baseUrl) || String(env.INTEGRA_CONTADOR_MODO || '').toUpperCase() === 'SERPRO_DIRETO';
  const endpoint = String(env.INTEGRA_CONTADOR_PGDAS_CONSULTAR_PATH || (serproDireto ? '/Consultar' : '/integra-contador/sn/pgdasd/consultar-declaracoes')).trim();
  // O Integra Contador exige autenticação SAPI com mTLS: é ela que entrega
  // o par access_token + jwt_token válido para a Receita/Integra Contador.
  const tokenUrl = String(env.INTEGRA_CONTADOR_TOKEN_URL || (serproDireto ? 'https://autenticacao.sapi.serpro.gov.br/authenticate' : '')).trim();
  const clientId = String(env.INTEGRA_CONTADOR_CLIENT_ID || '').trim();
  const clientSecret = String(env.INTEGRA_CONTADOR_CLIENT_SECRET || '').trim();
  const apiKey = String(env.INTEGRA_CONTADOR_API_KEY || '').trim();
  const bearer = String(env.INTEGRA_CONTADOR_ACCESS_TOKEN || '').trim();
  return {
    baseUrl, endpoint: endpoint.startsWith('/') ? endpoint : `/${endpoint}`, serproDireto,
    tokenUrl, clientId, clientSecret, apiKey, bearer,
    jwtToken: String(env.INTEGRA_CONTADOR_JWT_TOKEN || '').trim(),
    certificadoPfxBase64: String(env.INTEGRA_CONTADOR_CERTIFICADO_PFX_BASE64 || '').trim(),
    certificadoSenha: String(env.INTEGRA_CONTADOR_CERTIFICADO_SENHA || ''),
    incluirPartes: String(env.INTEGRA_CONTADOR_INCLUIR_PARTES || '').toLowerCase() === 'true',
    contratante: { tipo: Number(env.INTEGRA_CONTADOR_CONTRATANTE_TIPO || 2), numero: apenasDigitos(env.INTEGRA_CONTADOR_CONTRATANTE_NUMERO) },
    autorPedido: { tipo: Number(env.INTEGRA_CONTADOR_AUTOR_TIPO || 2), numero: apenasDigitos(env.INTEGRA_CONTADOR_AUTOR_NUMERO) },
  };
}

function status(env = process.env) {
  const c = config(env);
  const autenticacao = c.serproDireto
    ? (c.bearer && c.jwtToken ? 'tokens Serpro informados' : c.tokenUrl && c.clientId && c.clientSecret && c.certificadoPfxBase64 && c.certificadoSenha ? 'Serpro SAPI com certificado e-CNPJ' : null)
    : (c.bearer ? 'token de acesso' : c.apiKey ? 'chave de API' : c.tokenUrl && c.clientId && c.clientSecret ? 'OAuth client credentials' : null);
  return {
    configurado: Boolean(c.baseUrl && autenticacao), base_url_configurada: Boolean(c.baseUrl),
    autenticacao, endpoint: c.endpoint, modo: c.serproDireto ? 'SERPRO_DIRETO' : 'PROVEDOR_COMPATIVEL', incluir_partes: c.incluirPartes,
    mensagem: c.baseUrl && autenticacao ? 'Integra Contador pronto para consultar declarações PGDAS-D já transmitidas.' : c.serproDireto ? 'No Serpro direto, configure Consumer Key/Secret e o certificado e-CNPJ da contratante (PFX em Base64 e senha) no ambiente seguro.' : 'Defina no ambiente INTEGRA_CONTADOR_BASE_URL e uma credencial (ACCESS_TOKEN, API_KEY ou TOKEN_URL + CLIENT_ID + CLIENT_SECRET).',
  };
}

let tokenEmMemoria = null;
function solicitarTokenSerproComCertificado(c) {
  return new Promise((resolve, reject) => {
    let pfx; try { pfx = Buffer.from(c.certificadoPfxBase64, 'base64'); } catch (_) { reject(new Error('O certificado PFX do Integra Contador não está em Base64 válido.')); return; }
    if (!pfx.length) { reject(new Error('Informe o certificado PFX do Integra Contador em Base64.')); return; }
    const alvo = new URL(c.tokenUrl);
    const req = https.request(alvo, { method: 'POST', pfx, passphrase: c.certificadoSenha, rejectUnauthorized: true, timeout: 45000,
      headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`, 'Role-Type': 'TERCEIROS', 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'Content-Length': Buffer.byteLength('grant_type=client_credentials') } }, (resposta) => {
      let texto = ''; resposta.setEncoding('utf8'); resposta.on('data', (parte) => { texto += parte; }); resposta.on('end', () => {
        let dados; try { dados = JSON.parse(texto); } catch (_) { dados = {}; }
        if (resposta.statusCode < 200 || resposta.statusCode >= 300 || !dados.access_token || !dados.jwt_token) return reject(new Error(`Autenticação SAPI do Integra Contador falhou (${resposta.statusCode || 0}). Confirme o certificado e-CNPJ e as credenciais Serpro.`));
        resolve({ access_token: dados.access_token, jwt_token: dados.jwt_token, expires_in: dados.expires_in });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado na autenticação SAPI do Integra Contador.')));
    req.on('error', (e) => reject(new Error(`Não foi possível autenticar no SAPI do Serpro: ${e.message}`)));
    req.write('grant_type=client_credentials'); req.end();
  });
}
async function token(c, fetchImpl = fetch) {
  if (c.bearer) return { access_token: c.bearer, jwt_token: c.jwtToken || '' };
  if (!c.tokenUrl) return { access_token: '', jwt_token: '' };
  if (tokenEmMemoria?.expira_em > Date.now()) return tokenEmMemoria.valor;
  let dados;
  if (c.serproDireto) dados = await solicitarTokenSerproComCertificado(c);
  else {
    const credencial = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
    const resposta = await fetchImpl(c.tokenUrl, { method: 'POST', headers: { Authorization: `Basic ${credencial}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: 'grant_type=client_credentials' });
    const corpo = await resposta.text(); try { dados = JSON.parse(corpo); } catch (_) { dados = {}; }
    if (!resposta.ok || !dados.access_token) throw new Error(`Autenticação do Integra Contador falhou (${resposta.status}).`);
  }
  tokenEmMemoria = { valor: { access_token: dados.access_token, jwt_token: dados.jwt_token || '' }, expira_em: Date.now() + Math.max(60, Number(dados.expires_in || 300) - 30) * 1000 };
  return tokenEmMemoria.valor;
}

async function consultarDeclaracoes({ cnpj, anoCalendario, periodoApuracao = null }, { env = process.env, fetchImpl = fetch } = {}) {
  const c = config(env); const situacao = status(env);
  if (!situacao.configurado) throw new Error(situacao.mensagem);
  const documento = apenasDigitos(cnpj);
  if (documento.length !== 14) throw new Error('A empresa precisa ter CNPJ válido para consultar o PGDAS-D.');
  if (!Number.isInteger(Number(anoCalendario)) || Number(anoCalendario) < 2012) throw new Error('Informe um ano-calendário válido para consulta do PGDAS-D.');
  const periodo = String(periodoApuracao || '').replace(/\D/g, '');
  if (periodo && !/^\d{6}$/.test(periodo)) throw new Error('O período de apuração deve estar no formato AAAAMM.');
  const acesso = await token(c, fetchImpl);
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (acesso.access_token) headers.Authorization = `Bearer ${acesso.access_token}`;
  if (acesso.jwt_token) headers.jwt_token = acesso.jwt_token;
  if (c.apiKey) headers['x-api-key'] = c.apiKey;
  const dadosConsulta = periodo ? { periodoApuracao: periodo } : { anoCalendario: String(anoCalendario) };
  const corpo = c.serproDireto
    ? { contratante: c.contratante, autorPedidoDados: c.autorPedido, contribuinte: { tipo: 2, numero: documento }, pedidoDados: { idSistema: 'PGDASD', idServico: 'CONSDECLARACAO13', versaoSistema: '1.0', dados: JSON.stringify(dadosConsulta) } }
    : { dados: periodo ? dadosConsulta : { anoCalendario: Number(anoCalendario) }, contribuinte: { tipo: 2, numero: documento } };
  if (c.serproDireto && (!c.contratante.numero || !c.autorPedido.numero)) throw new Error('No Serpro direto, informe INTEGRA_CONTADOR_CONTRATANTE_NUMERO e INTEGRA_CONTADOR_AUTOR_NUMERO no ambiente seguro.');
  if (!c.serproDireto && c.incluirPartes) {
    if (!c.contratante.numero || !c.autorPedido.numero) throw new Error('Para este contrato, informe os identificadores de contratante e autor do pedido no ambiente.');
    corpo.contratante = c.contratante; corpo.autorPedido = c.autorPedido;
  }
  const resposta = await fetchImpl(`${c.baseUrl}${c.endpoint}`, { method: 'POST', headers, body: JSON.stringify(corpo), signal: AbortSignal.timeout(45000) });
  const texto = await resposta.text(); let dados;
  try { dados = texto ? JSON.parse(texto) : {}; } catch (_) { throw new Error('O Integra Contador respondeu em formato não reconhecido.'); }
  if (!resposta.ok || dados.success === false) {
    const mensagens = Array.isArray(dados.mensagens) ? dados.mensagens.map((m) => m?.texto || m?.mensagem || m?.descricao || '').filter(Boolean) : [];
    const detalhe = String(dados.message || dados.mensagem || dados.error_description || mensagens[0] || '').slice(0, 280);
    // A resposta direta do Serpro pode repetir o payload enviado em vez de
    // uma mensagem. Nunca devolvemos esse JSON à tela, pois ele só confunde e
    // não ajuda a resolver a permissão do cliente.
    if (resposta.status === 403 && c.serproDireto) throw new Error(`Acesso recusado pelo Serpro (403) para o CNPJ ${documento}. Confirme que o produto PGDAS-D está habilitado nas credenciais da Sattva e que este cliente concedeu procuração eletrônica e-CAC 00146 para a Sattva. ${detalhe && !/^\s*[{[]/.test(detalhe) ? detalhe : ''}`.trim());
    throw new Error(`Integra Contador respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : '.'}`);
  }
  // O gateway do Serpro devolve "dados" como JSON serializado; preservar o
  // envelope e converter esse conteúdo torna a origem auditável sem perder
  // mensagens e avisos da Receita.
  if (typeof dados.dados === 'string') { try { dados.dados = JSON.parse(dados.dados); } catch (_) { /* mantém o original */ } }
  return c.serproDireto ? dados : (dados.data ?? dados.dados ?? dados);
}

// Consulta oficial e somente leitura que permite separar uma procuração e-CAC
// inexistente de uma credencial Serpro sem permissão no PGDAS-D. Não usa nem
// grava dados de declaração.
async function verificarProcuracao({ cnpj }, { env = process.env, fetchImpl = fetch } = {}) {
  const c = config(env); const situacao = status(env);
  if (!situacao.configurado) throw new Error(situacao.mensagem);
  if (!c.serproDireto) return { disponivel: false, motivo: 'A verificação oficial de procuração está disponível no modo Serpro direto.' };
  const outorgante = apenasDigitos(cnpj);
  if (outorgante.length !== 14) throw new Error('A empresa precisa ter CNPJ válido para verificar a procuração.');
  if (!c.contratante.numero || !c.autorPedido.numero) throw new Error('No Serpro direto, informe INTEGRA_CONTADOR_CONTRATANTE_NUMERO e INTEGRA_CONTADOR_AUTOR_NUMERO no ambiente seguro.');
  const acesso = await token(c, fetchImpl);
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${acesso.access_token}` };
  if (acesso.jwt_token) headers.jwt_token = acesso.jwt_token;
  const corpo = {
    contratante: c.contratante, autorPedidoDados: c.autorPedido, contribuinte: { tipo: 2, numero: outorgante },
    pedidoDados: { idSistema: 'PROCURACOES', idServico: 'OBTERPROCURACAO41', versaoSistema: '1', dados: JSON.stringify({ outorgante, tipoOutorgante: '2', outorgado: c.autorPedido.numero, tipoOutorgado: String(c.autorPedido.tipo) }) },
  };
  const resposta = await fetchImpl(`${c.baseUrl}/Consultar`, { method: 'POST', headers, body: JSON.stringify(corpo), signal: AbortSignal.timeout(45000) });
  const texto = await resposta.text(); let dados;
  try { dados = texto ? JSON.parse(texto) : {}; } catch (_) { throw new Error('O Integra Contador respondeu à verificação de procuração em formato não reconhecido.'); }
  if (!resposta.ok) {
    const mensagens = Array.isArray(dados.mensagens) ? dados.mensagens.map((m) => m?.texto || m?.mensagem || '').filter(Boolean) : [];
    const detalhe = String(dados.message || dados.mensagem || mensagens[0] || '').slice(0, 240);
    throw new Error(`O Serpro recusou a verificação oficial de procuração (${resposta.status})${detalhe ? `: ${detalhe}` : '.'}`);
  }
  if (typeof dados.dados === 'string') { try { dados.dados = JSON.parse(dados.dados); } catch (_) { /* resposta preservada */ } }
  const lista = objetos(dados);
  const sistemas = [...new Set(lista.flatMap((x) => Array.isArray(x.sistemas) ? x.sistemas.map(String) : []))];
  const expiracao = lista.map((x) => x.dtexpiracao || x.dataExpiracao).find(Boolean) || null;
  return { disponivel: true, consulta_autenticada: true, outorgante, outorgado: c.autorPedido.numero,
    procuracao_encontrada: lista.some((x) => Array.isArray(x.sistemas) || x.dtexpiracao || x.dataExpiracao), sistemas, expiracao };
}

function objetos(valor, saida = [], vistos = new Set()) {
  if (typeof valor === 'string' && /^[{\[]/.test(valor.trim())) { try { return objetos(JSON.parse(valor), saida, vistos); } catch (_) { return saida; } }
  if (!valor || typeof valor !== 'object' || vistos.has(valor)) return saida;
  vistos.add(valor);
  if (Array.isArray(valor)) { valor.forEach((x) => objetos(x, saida, vistos)); return saida; }
  saida.push(valor); Object.values(valor).forEach((x) => objetos(x, saida, vistos)); return saida;
}
function primeiro(obj, nomes) {
  const indice = Object.fromEntries(Object.entries(obj).map(([k, v]) => [chave(k), v]));
  for (const nome of nomes) if (indice[chave(nome)] !== undefined) return indice[chave(nome)];
  return null;
}
function camposDeDeclaracao(declaracao) {
  const periodo = competencia(primeiro(declaracao, ['periodoApuracao', 'periodoDeApuracao', 'competencia', 'competenciaDeclaracao', 'periodo', 'referencia', 'mesAno', 'anoMes', 'mesReferencia', 'pa']));
  const mapa = {
    receita_bruta: ['receitaBruta', 'valorReceitaBruta', 'receitaBrutaTotal'],
    receita_mercadorias: ['receitaMercadorias', 'receitaComercio', 'receitaIndustria'],
    receita_servicos: ['receitaServicos', 'receitaServico'], receita_exportacao: ['receitaExportacao'],
    das: ['valorDas', 'das', 'valorTotalDas', 'valorDevidoDas', 'valorApuradoDas', 'dasDevido', 'valorDocumentoArrecadacao', 'valorAPagar'],
    pis: ['pis', 'valorPis', 'pisApurado'], cofins: ['cofins', 'valorCofins', 'cofinsApurada'],
  };
  const campos = [{ campo: 'competencia', valor_extraido: periodo, rotulo_original: 'período de apuração (Integra Contador)' }];
  for (const [campo, nomes] of Object.entries(mapa)) campos.push({ campo, valor_extraido: numero(primeiro(declaracao, nomes)), rotulo_original: `retorno ${nomes[0]} (Integra Contador)` });
  return campos.map((x) => ({ ...x, pagina_ou_localizacao: 'retorno estruturado da API', confianca: 1, metodo_extracao: 'INTEGRA_CONTADOR_PGDASD', status_validacao: x.valor_extraido === null ? 'INDETERMINADO' : 'REQUER_VALIDACAO' }));
}
function declaracoesPorCompetencia(resposta, competenciasAlvo = []) {
  const alvo = new Set(competenciasAlvo);
  const encontradas = new Map();
  for (const obj of objetos(resposta)) {
    const campos = camposDeDeclaracao(obj); const comp = campos[0].valor_extraido;
    if (!comp || (alvo.size && !alvo.has(comp))) continue;
    const das = campos.find((x) => x.campo === 'das')?.valor_extraido;
    if (das !== null && das !== undefined) encontradas.set(comp, { competencia: comp, campos, declaracao: obj });
  }
  return [...encontradas.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

// Não guarda o retorno bruto da Receita. O resumo permite distinguir: lista
// realmente vazia, período não reconhecido e declaração sem DAS identificado.
function diagnosticoDeclaracoes(resposta, competenciasAlvo = []) {
  const alvo = new Set(competenciasAlvo);
  const itens = objetos(resposta);
  let comPeriodo = 0, noPeriodoSolicitado = 0, comDas = 0, indicesDas = 0, indicesDeclaracao = 0;
  const camposDoPeriodo = new Set(), camposOperacoes = new Set();
  for (const item of itens) {
    const campos = camposDeDeclaracao(item);
    const competenciaEncontrada = campos.find((x) => x.campo === 'competencia')?.valor_extraido;
    if (!competenciaEncontrada) continue;
    comPeriodo++;
    if (alvo.size && !alvo.has(competenciaEncontrada)) continue;
    noPeriodoSolicitado++;
    // Somente nomes de propriedades: permite evoluir o parser sem armazenar
    // valores fiscais ou o envelope integral retornado pela Receita.
    Object.keys(item).forEach((chaveCampo) => camposDoPeriodo.add(String(chaveCampo).slice(0, 80)));
    const operacoes = item.operacoes;
    const listaOperacoes = Array.isArray(operacoes) ? operacoes : operacoes && typeof operacoes === 'object' ? [operacoes] : [];
    listaOperacoes.forEach((operacao) => {
      Object.keys(operacao || {}).forEach((chaveCampo) => camposOperacoes.add(String(chaveCampo).slice(0, 80)));
      if (operacao?.indiceDas) indicesDas++;
      if (operacao?.indiceDeclaracao) indicesDeclaracao++;
    });
    if (campos.find((x) => x.campo === 'das')?.valor_extraido !== null) comDas++;
  }
  return { objetos_analisados: itens.length, objetos_com_competencia: comPeriodo, objetos_no_periodo: noPeriodoSolicitado, objetos_com_das: comDas, operacoes_com_indice_declaracao: indicesDeclaracao, operacoes_com_indice_das: indicesDas, campos_identificados: [...camposDoPeriodo].sort().slice(0, 40), ...(camposOperacoes.size ? { campos_operacoes: [...camposOperacoes].sort().slice(0, 40) } : {}) };
}

module.exports = { config, status, consultarDeclaracoes, verificarProcuracao, declaracoesPorCompetencia, diagnosticoDeclaracoes, camposDeDeclaracao, competencia, numero };

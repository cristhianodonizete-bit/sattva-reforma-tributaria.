/*
 * Integra Contador — consulta somente leitura de PGDAS-D já transmitido.
 *
 * A contratação/credenciamento é feita fora do Sattva, junto ao Serpro ou ao
 * provedor homologado. Por isso URL, credenciais e o caminho contratado ficam
 * exclusivamente em variáveis de ambiente; nunca são enviados ao navegador ou
 * gravados no banco de dados da empresa.
 */
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
  // O OAuth do gateway Serpro é centralizado em /token, fora da rota v1 da
  // solução. Usar a URL-base da API aqui provoca 404 antes da consulta.
  const tokenUrl = String(env.INTEGRA_CONTADOR_TOKEN_URL || (serproDireto ? 'https://gateway.apiserpro.serpro.gov.br/token' : '')).trim();
  const clientId = String(env.INTEGRA_CONTADOR_CLIENT_ID || '').trim();
  const clientSecret = String(env.INTEGRA_CONTADOR_CLIENT_SECRET || '').trim();
  const apiKey = String(env.INTEGRA_CONTADOR_API_KEY || '').trim();
  const bearer = String(env.INTEGRA_CONTADOR_ACCESS_TOKEN || '').trim();
  return {
    baseUrl, endpoint: endpoint.startsWith('/') ? endpoint : `/${endpoint}`, serproDireto,
    tokenUrl, clientId, clientSecret, apiKey, bearer,
    incluirPartes: String(env.INTEGRA_CONTADOR_INCLUIR_PARTES || '').toLowerCase() === 'true',
    contratante: { tipo: Number(env.INTEGRA_CONTADOR_CONTRATANTE_TIPO || 2), numero: apenasDigitos(env.INTEGRA_CONTADOR_CONTRATANTE_NUMERO) },
    autorPedido: { tipo: Number(env.INTEGRA_CONTADOR_AUTOR_TIPO || 1), numero: apenasDigitos(env.INTEGRA_CONTADOR_AUTOR_NUMERO) },
  };
}

function status(env = process.env) {
  const c = config(env);
  const autenticacao = c.bearer ? 'token de acesso' : c.apiKey ? 'chave de API' : c.tokenUrl && c.clientId && c.clientSecret ? 'OAuth client credentials' : null;
  return {
    configurado: Boolean(c.baseUrl && autenticacao), base_url_configurada: Boolean(c.baseUrl),
    autenticacao, endpoint: c.endpoint, modo: c.serproDireto ? 'SERPRO_DIRETO' : 'PROVEDOR_COMPATIVEL', incluir_partes: c.incluirPartes,
    mensagem: c.baseUrl && autenticacao ? 'Integra Contador pronto para consultar declarações PGDAS-D já transmitidas.' : 'Defina no ambiente INTEGRA_CONTADOR_BASE_URL e uma credencial (ACCESS_TOKEN, API_KEY ou TOKEN_URL + CLIENT_ID + CLIENT_SECRET).',
  };
}

let tokenEmMemoria = null;
async function token(c, fetchImpl = fetch) {
  if (c.bearer) return { access_token: c.bearer, jwt_token: '' };
  if (!c.tokenUrl) return { access_token: '', jwt_token: '' };
  if (tokenEmMemoria?.expira_em > Date.now()) return tokenEmMemoria.valor;
  const credencial = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  const resposta = await fetchImpl(c.tokenUrl, { method: 'POST', headers: { Authorization: `Basic ${credencial}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: 'grant_type=client_credentials' });
  const corpo = await resposta.text();
  let dados; try { dados = JSON.parse(corpo); } catch (_) { dados = {}; }
  if (!resposta.ok || !dados.access_token) throw new Error(`Autenticação do Integra Contador falhou (${resposta.status}).`);
  tokenEmMemoria = { valor: { access_token: dados.access_token, jwt_token: dados.jwt_token || '' }, expira_em: Date.now() + Math.max(60, Number(dados.expires_in || 300) - 30) * 1000 };
  return tokenEmMemoria.valor;
}

async function consultarDeclaracoes({ cnpj, anoCalendario }, { env = process.env, fetchImpl = fetch } = {}) {
  const c = config(env); const situacao = status(env);
  if (!situacao.configurado) throw new Error(situacao.mensagem);
  const documento = apenasDigitos(cnpj);
  if (documento.length !== 14) throw new Error('A empresa precisa ter CNPJ válido para consultar o PGDAS-D.');
  if (!Number.isInteger(Number(anoCalendario)) || Number(anoCalendario) < 2012) throw new Error('Informe um ano-calendário válido para consulta do PGDAS-D.');
  const acesso = await token(c, fetchImpl);
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (acesso.access_token) headers.Authorization = `Bearer ${acesso.access_token}`;
  if (acesso.jwt_token) headers.jwt_token = acesso.jwt_token;
  if (c.apiKey) headers['x-api-key'] = c.apiKey;
  const corpo = c.serproDireto
    ? { contratante: c.contratante, autorPedidoDados: c.autorPedido, contribuinte: { tipo: 2, numero: documento }, pedidoDados: { idSistema: 'PGDASD', idServico: 'CONSDECLARACAO13', versaoSistema: '1.0', dados: JSON.stringify({ anoCalendario: String(anoCalendario) }) } }
    : { dados: { anoCalendario: Number(anoCalendario) }, contribuinte: { tipo: 2, numero: documento } };
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
  const periodo = competencia(primeiro(declaracao, ['periodoApuracao', 'competencia', 'periodo', 'referencia', 'mesAno']));
  const mapa = {
    receita_bruta: ['receitaBruta', 'valorReceitaBruta', 'receitaBrutaTotal'],
    receita_mercadorias: ['receitaMercadorias', 'receitaComercio', 'receitaIndustria'],
    receita_servicos: ['receitaServicos', 'receitaServico'], receita_exportacao: ['receitaExportacao'],
    das: ['valorDas', 'das', 'valorTotalDas', 'valorDevidoDas', 'valorApuradoDas'],
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

module.exports = { config, status, consultarDeclaracoes, declaracoesPorCompetencia, camposDeDeclaracao, competencia, numero };

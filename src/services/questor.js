/**
 * INTEGRAÇÃO nWeb (Questor)
 * ---------------------------------------------------------------------------
 * Cliente HTTP genérico para o serviço nWeb do Questor. Foi desenhado para ser
 * TOLERANTE a diferenças de versão: os caminhos, parâmetros e o de-para de
 * campos ficam em configuração (banco / src/config/questorEndpoints.js), não no
 * código. Assim, quando a instalação expõe nomes diferentes, basta ajustar a
 * tela "Integração Questor".
 */
const db = require('../db');
const padrao = require('../config/questorEndpoints');
const { resolverRegime, numeroBR, soDigitos } = require('./importador');

function config() {
  const row = db.prepare('SELECT * FROM questor_config WHERE id = 1').get() || {};
  let endpoints = padrao;
  try { if (row.endpoints) endpoints = { ...padrao, ...JSON.parse(row.endpoints) }; } catch (_) { /* usa padrão */ }
  return {
    baseUrl: (row.base_url || 'http://localhost:8080').replace(/\/+$/, ''),
    token: row.token || '',
    ativo: !!row.ativo,
    endpoints,
  };
}

function salvarConfig({ base_url, token, ativo, endpoints }) {
  db.prepare(`UPDATE questor_config SET base_url = ?, token = ?, ativo = ?, endpoints = ?,
    atualizado_em = datetime('now','localtime') WHERE id = 1`)
    .run(base_url || 'http://localhost:8080', token || '', ativo ? 1 : 0,
      typeof endpoints === 'string' ? endpoints : JSON.stringify(endpoints || padrao));
  return config();
}

function log(empresaId, endpoint, metodo, status, mensagem, registros = 0) {
  db.prepare(`INSERT INTO questor_log (empresa_id, endpoint, metodo, status, mensagem, registros)
    VALUES (?,?,?,?,?,?)`).run(empresaId || null, endpoint, metodo, status, String(mensagem || '').slice(0, 500), registros);
}

function interpolar(texto, ctx) {
  return String(texto).replace(/\{(\w+)\}/g, (_, k) => (ctx[k] !== undefined ? ctx[k] : ''));
}

/** Chamada crua — qualquer caminho do nWeb */
async function chamar({ path, metodo = 'GET', params = {}, body = null, timeout = 30000 }) {
  const cfg = config();
  const url = new URL(cfg.baseUrl + (path.startsWith('/') ? path : `/${path}`));
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (cfg.token) { headers.Authorization = `Bearer ${cfg.token}`; headers.Token = cfg.token; }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url.toString(), {
      method: metodo, headers, signal: ctrl.signal,
      body: body && metodo !== 'GET' ? JSON.stringify(body) : undefined,
    });
    const texto = await resp.text();
    let dados;
    try { dados = texto ? JSON.parse(texto) : null; } catch (_) { dados = texto; }
    if (!resp.ok) {
      const err = new Error(`nWeb respondeu ${resp.status}: ${String(texto).slice(0, 200)}`);
      err.status = resp.status; err.corpo = dados;
      throw err;
    }
    return dados;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Tempo esgotado ao chamar o nWeb. Verifique se o nWeb.exe está em execução e se a porta está liberada no firewall.');
    if (e.cause && ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(e.cause.code)) {
      throw new Error(`Não foi possível conectar em ${cfg.baseUrl}. Confirme o endereço/porta do nWeb (padrão 8080) e se o serviço está no ar.`);
    }
    throw e;
  } finally { clearTimeout(t); }
}

/** Testa a conexão usando os endpoints documentados */
async function testar() {
  const cfg = config();
  const resultados = [];
  for (const chave of ['versao', 'info']) {
    const ep = cfg.endpoints[chave];
    if (!ep) continue;
    try {
      const r = await chamar({ path: ep.path, metodo: ep.metodo || 'GET', timeout: 8000 });
      resultados.push({ endpoint: chave, path: ep.path, ok: true, resposta: r });
      log(null, ep.path, ep.metodo || 'GET', 'ok', 'teste de conexão');
    } catch (e) {
      resultados.push({ endpoint: chave, path: ep.path, ok: false, erro: e.message });
      log(null, ep.path, ep.metodo || 'GET', 'erro', e.message);
    }
  }
  return { baseUrl: cfg.baseUrl, ativo: cfg.ativo, resultados, conectado: resultados.some((r) => r.ok) };
}

/** Extrai a lista de registros de respostas em formatos variados */
function extrairLista(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  for (const k of ['dados', 'Dados', 'data', 'Data', 'result', 'Result', 'registros', 'Registros', 'itens', 'Itens', 'value']) {
    if (Array.isArray(resp[k])) return resp[k];
  }
  const primeiroArray = Object.values(resp).find((v) => Array.isArray(v));
  return primeiroArray || (typeof resp === 'object' ? [resp] : []);
}

/** Aplica o de-para configurado, tolerando diferenças de caixa/acento */
function aplicarMapa(registro, mapa) {
  if (!mapa) return registro;
  const indice = {};
  for (const k of Object.keys(registro)) {
    indice[String(k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')] = registro[k];
  }
  const saida = {};
  for (const [destino, origem] of Object.entries(mapa)) {
    const chave = String(origem).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    saida[destino] = registro[origem] !== undefined ? registro[origem] : indice[chave];
  }
  return saida;
}

/** Consulta genérica por chave de endpoint configurada */
async function consultar(chave, ctx = {}) {
  const cfg = config();
  const ep = cfg.endpoints[chave];
  if (!ep) throw new Error(`Endpoint "${chave}" não configurado. Ajuste em Integração Questor.`);
  const params = {};
  Object.entries(ep.params || {}).forEach(([k, v]) => { params[k] = interpolar(v, ctx); });
  const resp = await chamar({ path: interpolar(ep.path, ctx), metodo: ep.metodo || 'GET', params });
  const lista = extrairLista(resp);
  return lista.map((r) => aplicarMapa(r, ep.mapa));
}

/** Importa participantes (clientes/fornecedores) do Questor para uma empresa */
async function importarParticipantes(empresaId, tipo, ctx) {
  const brutos = await consultar('participantes', ctx);
  const ins = db.prepare(`INSERT INTO parceiros (empresa_id, tipo, cnpj, descricao, regime, uf, municipio, origem)
    VALUES (?,?,?,?,?,?,?, 'questor')
    ON CONFLICT(empresa_id, tipo, cnpj) DO UPDATE SET descricao = excluded.descricao,
      regime = excluded.regime, uf = excluded.uf, municipio = excluded.municipio, origem = 'questor'`);
  let n = 0;
  db.transaction(() => {
    for (const r of brutos) {
      const cnpj = soDigitos(r.cnpj);
      if (!cnpj) continue;
      ins.run(empresaId, tipo, cnpj, String(r.descricao || cnpj), resolverRegime(r.regime), r.uf || '', r.municipio || '');
      n++;
    }
  })();
  log(empresaId, 'participantes', 'GET', 'ok', `importados ${n}`, n);
  return { importados: n, total: brutos.length };
}

/** Importa movimentação (entradas/saídas) do Questor */
async function importarMovimentacao(empresaId, tipo, ctx) {
  const chave = tipo === 'cliente' ? 'saidas' : 'entradas';
  const brutos = await consultar(chave, ctx);
  const lote = db.prepare(`INSERT INTO lotes (empresa_id, tipo, arquivo, registros, origem) VALUES (?,?,?,?, 'questor')`)
    .run(empresaId, tipo, `nWeb/${chave} ${ctx.inicio || ''}-${ctx.fim || ''}`, brutos.length);
  const ins = db.prepare(`INSERT INTO movimentos
    (empresa_id, lote_id, tipo, nome, inscr_federal, descricao, ncm, cfop, cst, competencia,
     valor, base_calculo, icms, icms_st, ipi, pis, cofins, iss, origem)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'questor')`);
  let n = 0, total = 0;
  db.transaction(() => {
    for (const r of brutos) {
      const valor = numeroBR(r.valor);
      ins.run(empresaId, lote.lastInsertRowid, tipo, String(r.nome || ''), soDigitos(r.inscr_federal),
        String(r.descricao || ''), soDigitos(r.ncm), soDigitos(r.cfop), String(r.cst || ''), String(r.competencia || ''),
        valor, numeroBR(r.base_calculo) || valor, numeroBR(r.icms), numeroBR(r.icms_st), numeroBR(r.ipi),
        numeroBR(r.pis), numeroBR(r.cofins), numeroBR(r.iss));
      n++; total += valor;
    }
  })();
  db.prepare('UPDATE lotes SET registros = ?, valor_total = ? WHERE id = ?').run(n, total, lote.lastInsertRowid);
  log(empresaId, chave, 'GET', 'ok', `importados ${n}`, n);
  return { importados: n, valorTotal: total, loteId: lote.lastInsertRowid };
}

module.exports = { config, salvarConfig, chamar, testar, consultar, importarParticipantes, importarMovimentacao, extrairLista, aplicarMapa };

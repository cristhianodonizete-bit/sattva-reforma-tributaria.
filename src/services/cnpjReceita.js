/**
 * CONSULTA DE REGIME NA BASE DA RECEITA
 * ---------------------------------------------------------------------------
 * Resolve a lacuna que o XML e o SPED não cobrem: saber se a contraparte é
 * MEI, optante do Simples ou está no regime regular.
 *
 * O QUE ISTO RESOLVE — E O QUE NÃO RESOLVE
 *
 * A base pública do CNPJ informa a opção pelo Simples Nacional e pelo SIMEI.
 * Não informa Lucro Real x Lucro Presumido — essa distinção não consta do
 * cadastro público. E está tudo bem: para IBS/CBS o que importa é estar dentro
 * ou fora do Simples. Quem não é optante apura pelo regime regular, credita as
 * entradas e destaca integralmente nas saídas, seja Real ou Presumido.
 *
 * Por isso a consulta devolve exatamente os três enquadramentos que o motor
 * precisa: mei, simples_nacional ou regime_regular.
 *
 * PROVEDORES
 * Nenhum exige chave para o volume de um diagnóstico. Todos têm limite por
 * minuto, então a consulta em lote respeita um intervalo entre chamadas e
 * guarda o resultado em cache — reconsultar o mesmo CNPJ é desperdício e
 * consome a cota à toa.
 *
 * IMPORTANTE: o dado é do cadastro público e reflete a situação na data da
 * consulta. Ele é gravado com data e fonte; se o fornecedor mudar de regime,
 * a informação envelhece. Por isso o cache tem validade e a origem fica
 * registrada em cada parceiro.
 */
const db = require('./db_ref');
const filasAutomaticas = new Map();

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');

// --------------------------------------------------------------------------
// PROVEDORES
// --------------------------------------------------------------------------
const PROVEDORES = {
  brasilapi: {
    nome: 'BrasilAPI',
    // BRASILAPI_URL permite apontar para outro endereço com o mesmo contrato
    // (proxy interno da rede, ou ambiente de teste)
    url: (cnpj) => `${process.env.BRASILAPI_URL || 'https://brasilapi.com.br/api/cnpj/v1'}/${cnpj}`,
    exigeChave: false,
    intervalo: 1500,
    site: 'https://brasilapi.com.br',
    mapear: (d) => ({
      razao_social: d.razao_social || d.nome_fantasia || '',
      situacao: d.descricao_situacao_cadastral || '',
      porte: d.descricao_porte || '',
      cnae: String(d.cnae_fiscal || ''),
      cnae_descricao: d.cnae_fiscal_descricao || '',
      uf: d.uf || '', municipio: d.municipio || '',
      natureza_juridica: d.natureza_juridica || '', codigo_natureza_juridica: String(d.codigo_natureza_juridica || ''),
      efr: d.ente_federativo_responsavel || '',
      optante_simples: d.opcao_pelo_simples === true,
      data_opcao_simples: d.data_opcao_pelo_simples || null,
      data_exclusao_simples: d.data_exclusao_do_simples || null,
      optante_mei: d.opcao_pelo_mei === true,
      data_opcao_mei: d.data_opcao_pelo_mei || null,
      data_exclusao_mei: d.data_exclusao_do_mei || null,
    }),
  },
  cnpja: {
    nome: 'CNPJá (API aberta)',
    url: (cnpj) => `https://open.cnpja.com/office/${cnpj}`,
    exigeChave: false,
    intervalo: 13000,          // 5 consultas por minuto por IP
    site: 'https://cnpja.com/api/open',
    mapear: (d) => {
      const s = (d.company && d.company.simples) || {};
      const m = (d.company && d.company.simei) || {};
      return {
        razao_social: (d.company && d.company.name) || d.alias || '',
        situacao: (d.status && d.status.text) || '',
        porte: (d.company && d.company.size && d.company.size.text) || '',
        cnae: String((d.mainActivity && d.mainActivity.id) || ''),
        cnae_descricao: (d.mainActivity && d.mainActivity.text) || '',
        uf: (d.address && d.address.state) || '', municipio: (d.address && d.address.city) || '',
        optante_simples: s.optant === true,
        data_opcao_simples: s.since || null, data_exclusao_simples: s.until || null,
        optante_mei: m.optant === true,
        data_opcao_mei: m.since || null, data_exclusao_mei: m.until || null,
      };
    },
  },
  casadosdados: {
    nome: 'Casa dos Dados',
    url: (cnpj) => `https://api.casadosdados.com.br/v4/cnpj/${cnpj}`,
    exigeChave: true,
    intervalo: 120,
    site: 'https://docs.casadosdados.com.br/',
    mapear: (d) => ({
      razao_social: d.razao_social || d.nome_fantasia || '',
      situacao: (d.situacao_cadastral && d.situacao_cadastral.situacao_cadastral) || '',
      porte: (d.porte_empresa && d.porte_empresa.descricao) || '',
      cnae: '', cnae_descricao: '',
      uf: (d.endereco && d.endereco.uf) || '', municipio: (d.endereco && d.endereco.municipio) || '',
      // A resposta v4 documentada não contém opção pelo Simples/SIMEI. Nunca
      // interpretar a ausência desses campos como "não optante".
      opcao_simples_desconhecida: true,
      optante_simples: null, optante_mei: null,
      data_opcao_simples: null, data_exclusao_simples: null,
      data_opcao_mei: null, data_exclusao_mei: null,
    }),
  },
};

// --------------------------------------------------------------------------
// CONFIGURAÇÃO
// --------------------------------------------------------------------------
function config() {
  const r = db().prepare('SELECT * FROM cnpj_config WHERE id = 1').get() || {};
  // Casa dos Dados é fallback pago: a existência da chave não altera a
  // prioridade das fontes gratuitas.
  const chave = r.provedor && PROVEDORES[r.provedor] ? r.provedor : 'brasilapi';
  return {
    provedor: chave, ...PROVEDORES[chave],
    token: r.token || (chave === 'casadosdados' ? process.env.CASA_DOS_DADOS_API_KEY : process.env.CNPJ_API_TOKEN) || '',
    validade_dias: r.validade_dias || 90,
    ativo: r.ativo === undefined ? 1 : r.ativo,
    intervalo: r.intervalo || PROVEDORES[chave].intervalo,
  };
}

function salvarConfig(d) {
  db().prepare(`UPDATE cnpj_config SET provedor = ?, token = ?, validade_dias = ?, ativo = ?,
    intervalo = ?, atualizado_em = datetime('now','localtime') WHERE id = 1`)
    .run(d.provedor || 'brasilapi', d.token || '', Number(d.validade_dias) || 90,
      d.ativo ? 1 : 0, Number(d.intervalo) || 0);
  return config();
}

// --------------------------------------------------------------------------
// DERIVAÇÃO DO REGIME
// --------------------------------------------------------------------------
/**
 * Converte a situação cadastral no enquadramento que o motor usa.
 * A ordem importa: MEI é sempre também optante do Simples, então a
 * verificação do SIMEI vem primeiro.
 */
function derivarRegime(d) {
  if (d.opcao_simples_desconhecida) {
    return { regime: null, confianca: 'indeterminada',
      justificativa: 'A fonte confirmou o cadastro do CNPJ, mas não informou opção pelo Simples/SIMEI. Regime não foi presumido.' };
  }
  if (d.optante_mei) {
    return { regime: 'mei', confianca: 'alta',
      justificativa: `Optante pelo SIMEI desde ${d.data_opcao_mei || 'data não informada'}.` };
  }
  if (d.optante_simples) {
    return { regime: 'simples_nacional', confianca: 'alta',
      justificativa: `Optante pelo Simples Nacional desde ${d.data_opcao_simples || 'data não informada'}.` };
  }
  return { regime: 'regime_regular', confianca: 'alta',
    justificativa: 'Não optante pelo Simples Nacional — apura IBS/CBS pelo regime regular. O cadastro público não distingue Lucro Real de Presumido, e essa distinção não afeta o crédito de IBS/CBS.' };
}

function classificarEnteGovernamental(d, cnpj) {
  const natureza = String(d.natureza_juridica || '').toLowerCase();
  const efr = String(d.efr || '').toLowerCase();
  const texto = `${natureza} ${efr} ${d.razao_social || ''}`.toLowerCase();
  const tipo = /cons[oó]rcio p[uú]blico/.test(texto) ? ['Consórcio Público', 5]
    : /comit[eê].*gestor.*ibs/.test(texto) ? ['Comitê Gestor do IBS', 6]
      : /distrito federal/.test(texto) ? ['Distrito Federal', 3]
        : /uni[aã]o|federal/.test(efr) ? ['União', 1]
          : /estado/.test(efr) ? ['Estado', 2]
            : /munic[ií]pio|prefeitura/.test(efr) ? ['Município', 4] : [null, null];
  const publico = /administra[cç][aã]o p[uú]blica|autarquia|funda[cç][aã]o p[uú]blica/.test(natureza);
  const privado = /empresa p[uú]blica|economia mista|sociedade empres/.test(natureza);
  const confirmado = publico && !privado;
  const validar = !confirmado && !privado && (!d.natureza_juridica || !d.efr);
  return { cnpj, razao_social: d.razao_social || '', natureza_juridica: d.natureza_juridica || '', codigo_natureza_juridica: d.codigo_natureza_juridica || '', efr: d.efr || '', situacao_cadastral: d.situacao || '', entidade_publica: confirmado ? 'SIM' : 'NÃO', enquadrado: confirmado ? 'SIM' : 'NÃO', tipo_ente_governamental: tipo?.[0] || '', tpEnteGov: tipo?.[1] || null, aplicar_regra_compra_governamental: confirmado && tipo?.[1] ? 'SIM' : validar ? 'A VALIDAR' : 'NÃO', justificativa: confirmado ? 'Natureza jurídica cadastral indica administração pública direta, autarquia ou fundação pública.' : validar ? 'Cadastro consultado não informa elementos suficientes (natureza jurídica e/ou EFR) para concluir o enquadramento.' : 'Não há enquadramento automático: empresa estatal, sociedade de economia mista ou pessoa jurídica privada não recebe a regra de compra governamental.', fonte_cadastral: d.fonte || '', data_consulta: d.consultado_em || new Date().toISOString() };
}

// --------------------------------------------------------------------------
// CONSULTA
// --------------------------------------------------------------------------
function doCache(cnpj, validadeDias) {
  const r = db().prepare('SELECT * FROM cnpj_cache WHERE cnpj = ?').get(cnpj);
  if (!r) return null;
  const dias = (Date.now() - new Date(r.consultado_em.replace(' ', 'T')).getTime()) / 86400000;
  if (dias > validadeDias) return { ...r, vencido: true };
  return r;
}

function gravarCache(cnpj, d, fonte) {
  const reg = derivarRegime(d);
  db().prepare(`INSERT INTO cnpj_cache (cnpj, razao_social, situacao, porte, cnae, cnae_descricao,
    uf, municipio, optante_simples, data_opcao_simples, data_exclusao_simples,
    optante_mei, data_opcao_mei, data_exclusao_mei, regime_derivado, justificativa,
    fonte, consultado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'))
    ON CONFLICT(cnpj) DO UPDATE SET razao_social=excluded.razao_social, situacao=excluded.situacao,
      porte=excluded.porte, cnae=excluded.cnae, cnae_descricao=excluded.cnae_descricao,
      uf=excluded.uf, municipio=excluded.municipio,
      optante_simples=excluded.optante_simples, data_opcao_simples=excluded.data_opcao_simples,
      data_exclusao_simples=excluded.data_exclusao_simples, optante_mei=excluded.optante_mei,
      data_opcao_mei=excluded.data_opcao_mei, data_exclusao_mei=excluded.data_exclusao_mei,
      regime_derivado=excluded.regime_derivado, justificativa=excluded.justificativa,
      fonte=excluded.fonte, consultado_em=datetime('now','localtime')`)
    .run(cnpj, d.razao_social, d.situacao, d.porte, d.cnae, d.cnae_descricao, d.uf, d.municipio,
      d.optante_simples ? 1 : 0, d.data_opcao_simples, d.data_exclusao_simples,
      d.optante_mei ? 1 : 0, d.data_opcao_mei, d.data_exclusao_mei,
      reg.regime, reg.justificativa, fonte);
  return db().prepare('SELECT * FROM cnpj_cache WHERE cnpj = ?').get(cnpj);
}

/**
 * Consulta um CNPJ. Usa o cache quando válido.
 * @param {string} cnpj
 * @param {object} opcoes { forcar }
 */
async function consultar(cnpj, opcoes = {}) {
  const c = soDigitos(cnpj);
  if (c.length === 11) {
    return { cnpj: c, regime_derivado: 'pessoa_fisica', fonte: 'CPF',
      justificativa: 'Documento de 11 dígitos: pessoa física, não contribuinte de IBS/CBS pelo regime regular.',
      origem: 'derivado' };
  }
  if (c.length !== 14) throw new Error(`CNPJ inválido: ${cnpj}`);

  const cfg = config();
  if (!opcoes.forcar) {
    const cache = doCache(c, cfg.validade_dias);
    if (cache && !cache.vencido) return { ...cache, origem: 'cache' };
  }
  if (!cfg.ativo) throw new Error('Consulta à base da Receita está desativada nas configurações.');

  const consultarProvedor = async (provedor) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
    const headers = { Accept: 'application/json' };
    if (provedor.provedor === 'casadosdados') headers['api-key'] = cfg.token;
    else if (cfg.token) headers.Authorization = cfg.token.startsWith('Bearer') ? cfg.token : `Bearer ${cfg.token}`;
    const resp = await fetch(provedor.url(c), { headers, signal: ctrl.signal });
    if (resp.status === 404) {
      return { cnpj: c, regime_derivado: null, fonte: provedor.nome, origem: 'nao_encontrado',
        justificativa: 'CNPJ não localizado na base pública.' };
    }
    if (resp.status === 429) throw new Error(`Limite de consultas do ${provedor.nome} atingido.`);
    if (!resp.ok) throw new Error(`${provedor.nome} respondeu ${resp.status}.`);
    const bruto = await resp.json();
    const d = provedor.mapear(bruto);
    return { ...gravarCache(c, d, provedor.nome), origem: 'consulta', intervaloUsado: provedor.intervalo };
    } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Tempo esgotado na consulta ao ${provedor.nome}.`);
    if (e.cause && ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'].includes(e.cause.code)) {
      throw new Error(`Sem acesso a ${provedor.site}. Verifique a conexão ou o proxy da rede.`);
    }
    throw e;
    } finally { clearTimeout(t); }
  };

  try { return await consultarProvedor(cfg); }
  catch (e) {
    // Ordem deliberada de custo: fonte gratuita primária → fonte gratuita
    // alternativa → Casa dos Dados, apenas no último recurso.
    if (cfg.provedor !== 'brasilapi') throw e;
    try {
      const aberto = await consultarProvedor(PROVEDORES.cnpja);
      // Se a fonte aberta não localiza o CNPJ, a Casa dos Dados pode confirmar
      // a situação cadastral; só a chamamos quando há chave configurada.
      if (aberto.origem !== 'nao_encontrado' || !process.env.CASA_DOS_DADOS_API_KEY) {
        return { ...aberto, fallbackDe: cfg.nome };
      }
    } catch (_) { /* tenta a última fonte abaixo, se disponível */ }
    if (!process.env.CASA_DOS_DADOS_API_KEY) throw e;
    try {
      return { ...(await consultarProvedor({ ...PROVEDORES.casadosdados, provedor: 'casadosdados' })),
        fallbackDe: `${cfg.nome} → ${PROVEDORES.cnpja.nome}` };
    } catch (e3) { throw new Error(`${e.message} Fallback Casa dos Dados: ${e3.message}`); }
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Enriquece os parceiros de uma empresa.
 * Por padrão só toca em quem está SEM regime — não sobrescreve o que o
 * consultor já definiu à mão, a menos que peça explicitamente.
 */
async function enriquecerParceiros(empresaId, opcoes = {}) {
  const cfg = config();
  // "indeterminado" é ausência de conclusão, não um regime. Ele também deve
  // entrar no enriquecimento automático.
  const filtro = opcoes.sobrescrever ? '' : "AND (regime IS NULL OR regime = '' OR regime = 'indeterminado')";
  const tipoFiltro = opcoes.tipo ? 'AND tipo = ?' : '';
  const params = [empresaId];
  if (opcoes.tipo) params.push(opcoes.tipo);

  const alvos = db().prepare(`SELECT id, cnpj, descricao, tipo, regime FROM parceiros
    WHERE empresa_id = ? AND cnpj <> '' ${filtro} ${tipoFiltro}
    ORDER BY id`).all(...params).slice(0, Number(opcoes.limite) || 500);

  const rel = { total: alvos.length, atualizados: 0, cache: 0, consultados: 0,
    naoEncontrados: 0, erros: [], porRegime: {}, tempoEstimado: null, inativos: [] };
  if (!alvos.length) return rel;

  const up = db().prepare(`UPDATE parceiros SET regime = ?, regime_resolvido = ?, origem = 'receita' WHERE id = ?`);
  const evidencia = db().prepare(`INSERT INTO contraparte_regime_evidencias
    (parceiro_id, regime, fonte, ano_referencia, natureza, confianca, status, detalhe)
    VALUES (?,?,?,0,'atual','alta','confirmada',?)
    ON CONFLICT(parceiro_id, regime, fonte, ano_referencia, natureza)
    DO UPDATE SET confianca=excluded.confianca, status=excluded.status,
      detalhe=excluded.detalhe, consultado_em=datetime('now','localtime')`);

  for (let i = 0; i < alvos.length; i++) {
    const p = alvos[i];
    try {
      const antes = doCache(soDigitos(p.cnpj), cfg.validade_dias);
      const r = await consultar(p.cnpj, { forcar: opcoes.forcar });
      if (r.origem === 'cache') rel.cache++;
      else if (r.origem === 'consulta') rel.consultados++;
      else if (r.origem === 'nao_encontrado') { rel.naoEncontrados++; continue; }

      if (r.regime_derivado) {
        up.run(r.regime_derivado, r.regime_derivado, p.id);
        evidencia.run(p.id, r.regime_derivado, r.fonte || cfg.nome, r.justificativa || 'Consulta automática de cadastro público.');
        rel.atualizados++;
        rel.porRegime[r.regime_derivado] = (rel.porRegime[r.regime_derivado] || 0) + 1;
      }
      // Situação cadastral irregular é informação relevante para o diagnóstico
      if (r.situacao && !/ativa/i.test(r.situacao)) {
        rel.inativos.push({ cnpj: p.cnpj, nome: p.descricao, situacao: r.situacao });
      }
      // respeita o limite do provedor apenas quando houve consulta real
      if (r.origem === 'consulta' && i < alvos.length - 1) await esperar(r.intervaloUsado || cfg.intervalo);
    } catch (e) {
      rel.erros.push(`${p.cnpj} (${p.descricao || ''}): ${e.message}`);
      if (/Limite de consultas/.test(e.message)) break;   // não insiste contra o limite
    }
  }

  // revincula os movimentos ao regime recém-descoberto
  try {
    db().prepare(`UPDATE movimentos SET regime = (
        SELECT p.regime FROM parceiros p
        WHERE p.empresa_id = movimentos.empresa_id AND p.tipo = movimentos.tipo
          AND p.cnpj = movimentos.inscr_federal)
      WHERE empresa_id = ? AND inscr_federal <> ''`).run(empresaId);
  } catch (_) { /* segue */ }

  return rel;
}

/**
 * Dispara a resolução de novos CNPJs sem prender a requisição de importação.
 * Uma empresa tem no máximo uma fila ativa; importações sucessivas apenas
 * aproveitam a mesma execução e os pendentes restantes serão apanhados nela.
 */
function agendarEnriquecimento(empresaId, opcoes = {}) {
  const existente = filasAutomaticas.get(Number(empresaId));
  if (existente && existente.status === 'executando') return existente;
  const fila = { status: 'agendado', empresa_id: Number(empresaId), inicio: null, fim: null,
    resultado: null, erro: null };
  filasAutomaticas.set(Number(empresaId), fila);
  setImmediate(async () => {
    fila.status = 'executando'; fila.inicio = new Date().toISOString();
    try {
      fila.resultado = await enriquecerParceiros(empresaId, { ...opcoes, limite: opcoes.limite || 500 });
      fila.status = 'concluido';
    } catch (e) { fila.status = 'erro'; fila.erro = e.message; }
    finally { fila.fim = new Date().toISOString(); }
  });
  return fila;
}

function statusFila(empresaId) { return filasAutomaticas.get(Number(empresaId)) || null; }

/** Quanto ainda falta e quanto tempo levaria */
function pendencias(empresaId) {
  const cfg = config();
  const linhas = db().prepare(`SELECT tipo, COUNT(*) n, COALESCE(SUM(
      (SELECT SUM(m.valor) FROM movimentos m WHERE m.empresa_id = p.empresa_id
        AND m.tipo = p.tipo AND m.inscr_federal = p.cnpj)), 0) valor
    FROM parceiros p WHERE p.empresa_id = ? AND p.cnpj <> ''
      AND (p.regime IS NULL OR p.regime = '' OR p.regime = 'indeterminado') GROUP BY tipo`).all(empresaId);
  const emCache = db().prepare(`SELECT COUNT(*) c FROM parceiros p
    JOIN cnpj_cache k ON k.cnpj = p.cnpj
    WHERE p.empresa_id = ? AND (p.regime IS NULL OR p.regime = '' OR p.regime = 'indeterminado')`).get(empresaId).c;
  const total = linhas.reduce((s, l) => s + l.n, 0);
  return {
    porTipo: linhas, total, emCache,
    aConsultar: Math.max(total - emCache, 0),
    provedor: cfg.nome, intervalo: cfg.intervalo,
    tempoEstimadoSegundos: Math.round(Math.max(total - emCache, 0) * cfg.intervalo / 1000),
  };
}

function estatisticasCache() {
  const t = db().prepare('SELECT COUNT(*) c FROM cnpj_cache').get().c;
  const porRegime = db().prepare('SELECT regime_derivado, COUNT(*) c FROM cnpj_cache GROUP BY regime_derivado').all();
  const ultima = db().prepare('SELECT MAX(consultado_em) m FROM cnpj_cache').get().m;
  return { total: t, porRegime, ultimaConsulta: ultima, provedores: Object.entries(PROVEDORES)
    .map(([k, v]) => ({ chave: k, nome: v.nome, intervalo: v.intervalo, site: v.site, exigeChave: v.exigeChave })) };
}

module.exports = { consultar, enriquecerParceiros, agendarEnriquecimento, statusFila, pendencias, estatisticasCache,
  config, salvarConfig, derivarRegime, classificarEnteGovernamental, PROVEDORES };

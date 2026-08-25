/**
 * REPOSITÓRIO CENTRAL DE REGRAS DE CÁLCULO
 * ---------------------------------------------------------------------------
 * Ponto ÚNICO de onde todos os motores leem as regras. Nada de percentual,
 * limiar ou forma de cálculo escrito dentro da lógica.
 *
 * Cada regra vive no banco e é editável pela tela de Configurações. Os
 * arquivos em src/config/ deixam de ser a fonte da verdade e passam a ser
 * apenas a SEMENTE: alimentam as tabelas na primeira execução e servem de
 * referência para o botão "restaurar padrão".
 *
 * Grupos de regras:
 *   aliquotas    — IBS/CBS por ano e fatores da transição
 *   simples      — anexos e faixas do Simples Nacional
 *   regimes      — quem credita, quem gera crédito, alíquota de PIS/COFINS
 *   reducoes     — percentuais dos regimes diferenciados
 *   tributos     — forma de cálculo: por dentro, por fora, sai ou não da base
 *   cfop         — natureza da operação por grupo de CFOP
 *   limiares     — sensibilidade ao crédito, níveis de risco, tolerâncias
 *   padroes      — alíquotas presumidas quando o documento não traz o valor
 *
 * Cache em memória com invalidação a cada gravação: o motor roda sobre
 * milhares de itens e não pode consultar o banco a cada linha.
 */
const db = require('../db');

let CACHE = null;
const invalidar = () => { CACHE = null; };

// --------------------------------------------------------------------------
// LEITURA
// --------------------------------------------------------------------------
function carregar() {
  if (CACHE) return CACHE;

  const chaveValor = (grupo) => {
    const out = {};
    for (const r of db.prepare('SELECT chave, valor, tipo FROM param_regras WHERE grupo = ?').all(grupo)) {
      out[r.chave] = converter(r.valor, r.tipo);
    }
    return out;
  };

  const tributos = {};
  for (const t of db.prepare('SELECT * FROM param_tributos ORDER BY ordem').all()) {
    tributos[t.chave] = {
      chave: t.chave, label: t.label,
      forma: t.forma,                       // 'dentro' | 'fora'
      saiDaBase: !!t.sai_da_base,
      substituido: !!t.substituido,         // será substituído por IBS/CBS
      descricao: t.descricao,
    };
  }

  const regimes = {};
  for (const r of db.prepare('SELECT * FROM param_regimes ORDER BY ordem').all()) {
    regimes[r.chave] = {
      chave: r.chave, label: r.label,
      pisCofins: r.pis_cofins,
      cumulativo: r.cumulativo === null ? null : !!r.cumulativo,
      creditaAtualPisCofins: !!r.credita_atual_piscofins,
      creditaAtualIcms: !!r.credita_atual_icms,
      creditaAtualIpi: !!r.credita_atual_ipi,
      geraCreditoAtualPisCofins: !!r.gera_atual_piscofins,
      geraCreditoAtualIcms: !!r.gera_atual_icms,
      geraCreditoAtualIpi: !!r.gera_atual_ipi,
      creditaNovo: !!r.credita_novo,
      geraCreditoNovo: !!r.gera_credito_novo,
      noDas: !!r.no_das,
      creditoCbsSimplesReferencia: r.credito_cbs_simples_referencia === null ? null : Number(r.credito_cbs_simples_referencia),
      obs: r.obs,
    };
  }

  const reducoes = {};
  for (const r of db.prepare('SELECT * FROM param_reducoes ORDER BY ordem').all()) {
    reducoes[r.chave] = {
      chave: r.chave, label: r.label,
      reducao: r.reducao, especifico: !!r.especifico,
      desc: r.descricao,
    };
  }

  const cfop = db.prepare('SELECT * FROM param_cfop ORDER BY prioridade, natureza, grupo').all();

  CACHE = {
    tributos, regimes, reducoes, cfop,
    limiares: chaveValor('limiares'),
    padroes: chaveValor('padroes'),
    aliquotas: db.prepare('SELECT * FROM param_aliquotas ORDER BY ano').all(),
    anos: db.prepare('SELECT ano FROM param_aliquotas ORDER BY ano').all().map((x) => x.ano),
  };
  return CACHE;
}

function converter(valor, tipo) {
  if (tipo === 'numero' || tipo === 'percentual') return Number(valor);
  if (tipo === 'booleano') return valor === '1' || valor === 'true';
  return valor;
}

// --------------------------------------------------------------------------
// ACESSO PELOS MOTORES
// --------------------------------------------------------------------------
/** Forma de cálculo de um tributo: define se ele sai da base econômica */
function tributo(chave) {
  const t = carregar().tributos[chave];
  return t || { chave, label: chave, forma: 'dentro', saiDaBase: true, substituido: true };
}
function regime(chave) {
  return carregar().regimes[chave] || null;
}
function reducao(chave) {
  return carregar().reducoes[chave] || carregar().reducoes.integral || { reducao: 0 };
}
/** Percentual de redução de uma chave — 0,60 para "redução de 60%" */
function percentualReducao(chave) {
  const r = carregar().reducoes[chave];
  return r ? Number(r.reducao) || 0 : 0;
}
function limiar(chave, padrao) {
  const v = carregar().limiares[chave];
  return v === undefined ? padrao : v;
}
function padrao(chave, valorPadrao) {
  const v = carregar().padroes[chave];
  return v === undefined ? valorPadrao : v;
}
function aliquotasAno(ano) {
  return carregar().aliquotas.find((a) => a.ano === Number(ano)) || null;
}
function anos() { return carregar().anos; }

/** Natureza da operação a partir do CFOP, conforme cadastro */
function naturezaCfop(cfop) {
  const c = String(cfop || '').replace(/\D/g, '');
  if (c.length !== 4) return null;
  const grupo = c.slice(1);
  // A ordem importa: o primeiro dígito distingue operação com o exterior e
  // precisa ser avaliado antes do grupo. CFOP 5102 é venda interna; 3102 é
  // importação — os três últimos dígitos são iguais.
  for (const p of [1, 2, 3]) {
    const linha = carregar().cfop.find((l) => (l.prioridade || 2) === p && (
      (l.grupo && l.grupo === grupo) || (l.prefixo && !l.grupo && c.startsWith(l.prefixo))
    ));
    if (linha) return linha.natureza;
  }
  return null;
}

/** Alíquota de PIS/COFINS presumida para um regime, quando não há destaque */
function estimativaPisCofins(chaveRegime) {
  const r = regime(chaveRegime);
  if (!r) return null;
  return r.pisCofins === null || r.pisCofins === undefined ? null : Number(r.pisCofins);
}

// --------------------------------------------------------------------------
// ESCRITA (usada pela tela de Configurações)
// --------------------------------------------------------------------------
function registrarLog(grupo, chave, antes, depois, usuario) {
  db.prepare(`INSERT INTO param_log (grupo, chave, valor_anterior, valor_novo, usuario)
    VALUES (?,?,?,?,?)`).run(grupo, chave, String(antes ?? ''), String(depois ?? ''), usuario || 'sistema');
}

function salvarRegra(grupo, chave, valor, usuario) {
  const atual = db.prepare('SELECT valor FROM param_regras WHERE grupo = ? AND chave = ?').get(grupo, chave);
  db.prepare(`UPDATE param_regras SET valor = ?, atualizado_em = datetime('now','localtime')
    WHERE grupo = ? AND chave = ?`).run(String(valor), grupo, chave);
  registrarLog(grupo, chave, atual ? atual.valor : null, valor, usuario);
  invalidar();
}

function salvarTributo(chave, dados, usuario) {
  const antes = db.prepare('SELECT * FROM param_tributos WHERE chave = ?').get(chave);
  db.prepare(`UPDATE param_tributos SET forma = ?, sai_da_base = ?, substituido = ?, descricao = ?
    WHERE chave = ?`).run(dados.forma, dados.saiDaBase ? 1 : 0, dados.substituido ? 1 : 0,
    dados.descricao || (antes && antes.descricao) || '', chave);
  registrarLog('tributos', chave,
    antes ? `${antes.forma}/${antes.sai_da_base}` : '',
    `${dados.forma}/${dados.saiDaBase ? 1 : 0}`, usuario);
  invalidar();
}

function salvarRegime(chave, d, usuario) {
  const antes = db.prepare('SELECT * FROM param_regimes WHERE chave = ?').get(chave);
  db.prepare(`UPDATE param_regimes SET pis_cofins = ?, credito_cbs_simples_referencia = ?, credita_novo = ?, gera_credito_novo = ?,
    credita_atual_piscofins = ?, credita_atual_icms = ?, credita_atual_ipi = ?,
    gera_atual_piscofins = ?, gera_atual_icms = ?, gera_atual_ipi = ?, no_das = ?, obs = ?
    WHERE chave = ?`).run(
    d.pisCofins === '' || d.pisCofins === null || d.pisCofins === undefined ? null : Number(d.pisCofins),
    d.creditoCbsSimplesReferencia === '' || d.creditoCbsSimplesReferencia === null || d.creditoCbsSimplesReferencia === undefined ? null : Number(d.creditoCbsSimplesReferencia),
    d.creditaNovo ? 1 : 0, d.geraCreditoNovo ? 1 : 0,
    d.creditaAtualPisCofins ? 1 : 0, d.creditaAtualIcms ? 1 : 0, d.creditaAtualIpi ? 1 : 0,
    d.geraCreditoAtualPisCofins ? 1 : 0, d.geraCreditoAtualIcms ? 1 : 0, d.geraCreditoAtualIpi ? 1 : 0,
    d.noDas ? 1 : 0, d.obs || (antes && antes.obs) || '', chave);
  registrarLog('regimes', chave, antes ? JSON.stringify({ credita: antes.credita_novo, gera: antes.gera_credito_novo }) : '',
    JSON.stringify({ credita: d.creditaNovo ? 1 : 0, gera: d.geraCreditoNovo ? 1 : 0 }), usuario);
  invalidar();
}

function salvarReducao(chave, d, usuario) {
  const antes = db.prepare('SELECT reducao FROM param_reducoes WHERE chave = ?').get(chave);
  db.prepare('UPDATE param_reducoes SET reducao = ?, label = ?, descricao = ? WHERE chave = ?')
    .run(Number(d.reducao) || 0, d.label, d.descricao || '', chave);
  registrarLog('reducoes', chave, antes ? antes.reducao : '', d.reducao, usuario);
  invalidar();
}

function normalizarPercentual(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return valor > 1 ? valor / 100 : valor;
  let texto = String(valor).trim().replace(/%/g, '').replace(/[R$\s]/g, '');
  if (texto.includes(',') && texto.includes('.')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (texto.includes(',')) texto = texto.replace(',', '.');
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return 0;
  return numero > 1 ? numero / 100 : numero;
}

function salvarAliquota(ano, d, usuario) {
  const antes = db.prepare('SELECT ibs, cbs FROM param_aliquotas WHERE ano = ?').get(ano);
  db.prepare(`UPDATE param_aliquotas SET ibs = ?, cbs = ?, calcular_ibs = ?, fator_icms_iss = ?, fator_pis_cofins = ?,
    fator_ipi = ?, compensavel = ?, simulacao = ?, fonte = ?, nota = ?,
    atualizado_em = datetime('now','localtime') WHERE ano = ?`)
    .run(normalizarPercentual(d.ibs), normalizarPercentual(d.cbs), d.calcular_ibs ? 1 : 0, Number(d.fator_icms_iss) || 0,
      Number(d.fator_pis_cofins) || 0, Number(d.fator_ipi) || 0,
      d.compensavel ? 1 : 0, d.simulacao ? 1 : 0, d.fonte || '', d.nota || '', ano);
  registrarLog('aliquotas', String(ano), antes ? `IBS ${antes.ibs} / CBS ${antes.cbs}` : '',
    `IBS ${normalizarPercentual(d.ibs)} / CBS ${normalizarPercentual(d.cbs)}`, usuario);
  invalidar();
}

function salvarSimples(anexo, faixa, d, usuario) {
  const antes = db.prepare('SELECT aliquota_nominal, parcela_deduzir FROM param_simples WHERE anexo = ? AND faixa = ?').get(anexo, faixa);
  db.prepare(`UPDATE param_simples SET limite = ?, aliquota_nominal = ?, parcela_deduzir = ?,
    rep_cofins = ?, rep_pis = ?, rep_icms_iss = ? WHERE anexo = ? AND faixa = ?`)
    .run(Number(d.limite) || 0, Number(d.aliquota_nominal) || 0, Number(d.parcela_deduzir) || 0,
      Number(d.rep_cofins) || 0, Number(d.rep_pis) || 0, Number(d.rep_icms_iss) || 0, anexo, faixa);
  registrarLog('simples', `${anexo}-${faixa}`,
    antes ? `${antes.aliquota_nominal}/${antes.parcela_deduzir}` : '',
    `${d.aliquota_nominal}/${d.parcela_deduzir}`, usuario);
  invalidar();
}

function salvarCfop(id, d, usuario) {
  db.prepare('UPDATE param_cfop SET natureza = ?, descricao = ? WHERE id = ?')
    .run(d.natureza, d.descricao || '', id);
  registrarLog('cfop', String(id), '', d.natureza, usuario);
  invalidar();
}

function historico(limite = 100) {
  return db.prepare('SELECT * FROM param_log ORDER BY id DESC LIMIT ?').all(Math.min(Number(limite) || 100, 500));
}

/** Devolve tudo o que a tela de Configurações precisa exibir */
function tudo() {
  const c = carregar();
  return {
    aliquotas: c.aliquotas,
    simples: db.prepare('SELECT * FROM param_simples ORDER BY anexo, faixa').all(),
    tributos: Object.values(c.tributos),
    regimes: Object.values(c.regimes),
    reducoes: Object.values(c.reducoes),
    cfop: c.cfop,
    limiares: db.prepare("SELECT * FROM param_regras WHERE grupo = 'limiares' ORDER BY ordem, chave").all(),
    padroes: db.prepare("SELECT * FROM param_regras WHERE grupo = 'padroes' ORDER BY ordem, chave").all(),
    capacitacao: db.prepare("SELECT * FROM param_regras WHERE grupo = 'capacitacao' ORDER BY ordem, chave").all(),
    historico: historico(40),
  };
}

module.exports = {
  carregar, invalidar, tributo, regime, reducao, percentualReducao, limiar, padrao,
  aliquotasAno, anos, naturezaCfop, estimativaPisCofins,
  salvarRegra, salvarTributo, salvarRegime, salvarReducao, salvarAliquota, salvarSimples, salvarCfop,
  historico, tudo,
};

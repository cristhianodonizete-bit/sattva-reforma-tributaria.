/**
 * BASES DA RECEITA — LUCRO REAL E LUCRO PRESUMIDO
 * ---------------------------------------------------------------------------
 * Importa as relações anuais publicadas pela Receita Federal, com milhões de
 * linhas, para uma tabela local indexada. Depois disso a consulta é instantânea
 * e offline — nenhuma chamada de API por CNPJ.
 *
 * O QUE ESTAS BASES RESOLVEM — E O QUE NÃO RESOLVEM
 *
 * Elas distinguem Lucro Real de Lucro Presumido. Isso NÃO altera o crédito de
 * IBS/CBS: os dois apuram pelo regime regular e creditam igual. O que melhora
 * é a RECONSTRUÇÃO DA CARGA ATUAL — quando o documento não traz PIS/COFINS
 * destacado, o motor estima por 9,25% (não cumulativo, Real) ou 3,65%
 * (cumulativo, Presumido). Errar aí distorce a base econômica.
 *
 * PRECEDÊNCIA DAS FONTES DE REGIME
 *
 *   1. definição manual do consultor        (sempre vence)
 *   2. Simples/MEI — API da Receita ou XML  (decide o CRÉDITO)
 *   3. estas bases                          (refina Real x Presumido)
 *   4. CRT do XML / opSimpNac da NFS-e      (indício)
 *
 * A ordem não é arbitrária: quem é optante do Simples não está nestas bases,
 * e se estiver em ambas a informação do Simples prevalece porque é ela que
 * determina o comportamento do crédito.
 *
 * LEITURA EM STREAMING
 *
 * Arquivo de 60 MB e 1,2 milhão de linhas não cabe confortavelmente em
 * memória como string única. A leitura é feita por blocos, com inserção em
 * lotes dentro de uma transação — a diferença entre inserir linha a linha e
 * em lote, neste volume, é de minutos para segundos.
 */
const fs = require('fs');
const readline = require('readline');
const db = require('./db_ref');
const supabase = require('./supabase');

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const REGIMES_VALIDOS = { lucro_real: 'Lucro Real', lucro_presumido: 'Lucro Presumido',
  lucro_arbitrado: 'Lucro Arbitrado', imune_isento: 'Imune ou Isenta' };

/** Texto da coluna "forma de tributação" → chave usada pelo motor */
function regimePorTexto(txt) {
  const n = norm(txt);
  if (!n) return null;
  if (n.includes('presumido')) return 'lucro_presumido';
  if (n.includes('arbitrado')) return 'lucro_arbitrado';
  if (n.includes('real')) return 'lucro_real';
  if (n.includes('imune') || n.includes('isenta') || n.includes('isento')) return 'imune_isento';
  return null;
}

// --------------------------------------------------------------------------
// DETECÇÃO DE LEIAUTE
// --------------------------------------------------------------------------
/** Descobre separador, encoding e a coluna do CNPJ a partir das primeiras linhas */
function detectar(caminho) {
  const buf = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(caminho, 'r');
  const lidos = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const bruto = buf.subarray(0, lidos);

  // encoding: se o UTF-8 produz caractere de substituição, é latin1
  const utf8 = bruto.toString('utf8');
  const encoding = utf8.includes('\uFFFD') ? 'latin1' : 'utf8';
  const texto = encoding === 'latin1' ? bruto.toString('latin1') : utf8;

  const linhas = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  if (!linhas.length) throw new Error('Arquivo vazio.');

  // separador: o que mais aparece de forma consistente
  const candidatos = [';', ',', '\t', '|'];
  const sep = candidatos
    .map((s) => ({ s, n: linhas[0].split(s).length, consistente: linhas.slice(1, 6)
      .every((l) => Math.abs(l.split(s).length - linhas[0].split(s).length) <= 1) }))
    .filter((x) => x.n > 1 && x.consistente)
    .sort((a, b) => b.n - a.n)[0];
  const separador = sep ? sep.s : ';';

  const primeira = linhas[0].split(separador).map((c) => c.trim().replace(/^"|"$/g, ''));
  const segunda = (linhas[1] || '').split(separador).map((c) => c.trim().replace(/^"|"$/g, ''));

  // cabeçalho existe se a primeira linha não tem CNPJ e a segunda tem
  const pareceCnpj = (v) => { const d = soDigitos(v); return d.length === 14 || d.length === 8; };
  const temCabecalho = !primeira.some(pareceCnpj) && segunda.some(pareceCnpj);

  // coluna do CNPJ: pelo nome do cabeçalho, ou pela primeira que tem cara de CNPJ
  let colCnpj = -1;
  if (temCabecalho) {
    const nomes = ['cnpj', 'cnpjbasico', 'numerocnpj', 'nrcnpj', 'cnpjcompleto', 'inscricao'];
    colCnpj = primeira.findIndex((c) => nomes.includes(norm(c)));
    if (colCnpj < 0) colCnpj = primeira.findIndex((c) => norm(c).includes('cnpj'));
  }
  if (colCnpj < 0) colCnpj = (temCabecalho ? segunda : primeira).findIndex(pareceCnpj);
  if (colCnpj < 0) throw new Error('Não foi possível localizar a coluna do CNPJ. Verifique o arquivo.');

  const amostra = (temCabecalho ? segunda : primeira)[colCnpj];
  const digitos = soDigitos(amostra).length;

  // A relação da Receita traz o ANO e a FORMA DE TRIBUTAÇÃO em cada linha.
  // Quando existem, mandam mais do que o que o usuário digitou na tela: um
  // arquivo pode conter mais de um regime, e o ano é o do próprio dado.
  let colAno = -1, colForma = -1, colScp = -1;
  if (temCabecalho) {
    colAno = primeira.findIndex((c) => ['ano', 'anocalendario', 'exercicio'].includes(norm(c)));
    colForma = primeira.findIndex((c) => ['formadetributacao', 'formatributacao', 'regime',
      'regimetributario', 'tributacao'].includes(norm(c)));
    colScp = primeira.findIndex((c) => norm(c).includes('scp'));
  }

  return { encoding, separador, temCabecalho, colCnpj, colAno, colForma, colScp,
    colunas: temCabecalho ? primeira : primeira.map((_, i) => `coluna ${i + 1}`),
    formatoCnpj: digitos === 8 ? 'raiz' : 'completo',
    exemplo: amostra, totalColunas: primeira.length,
    regimePorLinha: colForma >= 0,
    anoPorLinha: colAno >= 0 };
}

// --------------------------------------------------------------------------
// IMPORTAÇÃO
// --------------------------------------------------------------------------
/**
 * @param {string} caminho   arquivo CSV
 * @param {string} regime    lucro_real | lucro_presumido | ...
 * @param {object} opcoes    { ano, substituir, aoProgresso }
 */
async function importar(caminho, regime, opcoes = {}) {
  if (!REGIMES_VALIDOS[regime]) throw new Error(`Regime inválido: ${regime}`);
  if (!fs.existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);

  const leiaute = opcoes.leiaute || detectar(caminho);
  const ano = Number(opcoes.ano) || new Date().getFullYear() - 1;
  const arquivo = caminho.split(/[\\/]/).pop();
  const D = db();

  if (opcoes.substituir) {
    // Com regime por linha o arquivo pode conter vários regimes: apagar só um
    // deles deixaria resíduo. Nesse caso a limpeza é pela própria fonte.
    if (leiaute.colForma >= 0) D.prepare('DELETE FROM base_regime WHERE fonte = ?').run(arquivo);
    else D.prepare('DELETE FROM base_regime WHERE regime = ? AND ano = ?').run(regime, ano);
  }

  const ins = D.prepare(`INSERT INTO base_regime (cnpj, raiz, regime, ano, fonte)
    VALUES (?,?,?,?,?)
    ON CONFLICT(cnpj, ano) DO UPDATE SET regime = excluded.regime, fonte = excluded.fonte`);

  const rel = { arquivo, regime, ano, linhas: 0, importados: 0, invalidos: 0,
    duplicados: 0, semRegime: 0, comScp: 0, porRegime: {}, porAno: {},
    leiaute, inicio: Date.now() };

  const lote = [];
  const LOTE = 5000;
  const gravarLote = D.transaction((linhas) => { for (const l of linhas) ins.run(...l); });

  const stream = fs.createReadStream(caminho, { encoding: leiaute.encoding });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let primeira = true;
  const vistos = new Set();

  for await (const linha of rl) {
    if (primeira && leiaute.temCabecalho) { primeira = false; continue; }
    primeira = false;
    if (!linha.trim()) continue;
    rel.linhas++;

    const campos = linha.split(leiaute.separador);
    const bruto = (campos[leiaute.colCnpj] || '').trim().replace(/^"|"$/g, '');
    const d = soDigitos(bruto);

    let cnpj = null;
    if (d.length === 14) cnpj = d;
    else if (d.length === 8) cnpj = d;              // raiz: vale para todas as filiais
    else { rel.invalidos++; continue; }

    // Regime e ano da PRÓPRIA LINHA têm precedência sobre o que foi informado
    // na tela: um arquivo pode misturar formas de tributação, e o ano correto
    // é o do dado, não o que o usuário digitou.
    let regimeLinha = regime, anoLinha = ano;
    if (leiaute.colForma >= 0) {
      const r = regimePorTexto((campos[leiaute.colForma] || '').replace(/^"|"$/g, ''));
      if (r) regimeLinha = r;
      else { rel.semRegime++; continue; }   // linha sem forma reconhecível não entra
    }
    if (leiaute.colAno >= 0) {
      const a = parseInt(soDigitos(campos[leiaute.colAno]), 10);
      if (a >= 1990 && a <= 2100) anoLinha = a;
    }
    if (leiaute.colScp >= 0) {
      const scp = soDigitos(campos[leiaute.colScp]);
      if (scp && scp !== '0' && Number(scp) !== 0) rel.comScp++;
    }

    const chaveUnica = `${cnpj}|${anoLinha}`;
    if (vistos.has(chaveUnica)) { rel.duplicados++; continue; }
    vistos.add(chaveUnica);
    rel.porRegime[regimeLinha] = (rel.porRegime[regimeLinha] || 0) + 1;
    rel.porAno[anoLinha] = (rel.porAno[anoLinha] || 0) + 1;

    lote.push([cnpj, cnpj.slice(0, 8), regimeLinha, anoLinha, arquivo]);
    if (lote.length >= LOTE) {
      gravarLote(lote); rel.importados += lote.length; lote.length = 0;
      if (opcoes.aoProgresso) opcoes.aoProgresso(rel);
    }
  }
  if (lote.length) { gravarLote(lote); rel.importados += lote.length; }

  rel.segundos = Math.round((Date.now() - rel.inicio) / 100) / 10;
  D.prepare(`INSERT INTO base_regime_importacoes (arquivo, regime, ano, linhas, importados,
    invalidos, duplicados, segundos) VALUES (?,?,?,?,?,?,?,?)`)
    .run(arquivo, Object.keys(rel.porRegime).join(', ') || regime,
      Object.keys(rel.porAno).join(', ') || ano,
      rel.linhas, rel.importados, rel.invalidos, rel.duplicados, rel.segundos);
  return rel;
}

// --------------------------------------------------------------------------
// CONSULTA
// --------------------------------------------------------------------------
/**
 * Consulta o regime de um CNPJ nas bases importadas.
 * Tenta o CNPJ completo; se não achar, tenta a raiz — as listas da Receita
 * frequentemente trazem só a raiz, e o regime é da pessoa jurídica, não do
 * estabelecimento, então herdar da matriz é correto.
 */
function consultar(cnpj, ano) {
  const d = soDigitos(cnpj);
  if (d.length !== 14 && d.length !== 8) return null;
  const D = db();
  const filtroAno = ano ? ' AND ano = ?' : '';
  const p = ano ? [ano] : [];

  let r = D.prepare(`SELECT * FROM base_regime WHERE cnpj = ?${filtroAno} ORDER BY ano DESC LIMIT 1`).get(d, ...p);
  if (r) return { ...r, nivel: 'cnpj' };
  r = D.prepare(`SELECT * FROM base_regime WHERE cnpj = ?${filtroAno} ORDER BY ano DESC LIMIT 1`).get(d.slice(0, 8), ...p);
  if (r) return { ...r, nivel: 'raiz' };
  r = D.prepare(`SELECT * FROM base_regime WHERE raiz = ?${filtroAno} ORDER BY ano DESC LIMIT 1`).get(d.slice(0, 8), ...p);
  return r ? { ...r, nivel: 'raiz' } : null;
}

/**
 * Refina os parceiros que já se sabe estarem no regime regular.
 * NÃO toca em quem é Simples ou MEI: a informação do Simples tem precedência
 * porque é ela que determina o crédito. E não toca em definição manual.
 */
async function consultarCompartilhada(cnpjs, ano) {
  if (!supabase.configurado() || !cnpjs.length) return new Map();

  // A lista pública frequentemente usa a raiz; por isso consultamos as duas
  // chaves. A consulta é em lote, nunca uma chamada por parceiro.
  const chaves = [...new Set(cnpjs.flatMap((cnpj) => {
    const d = soDigitos(cnpj);
    return d.length === 14 ? [d, d.slice(0, 8)] : d.length === 8 ? [d] : [];
  }))];
  const encontrados = new Map();
  const remoto = supabase.admin();

  for (let i = 0; i < chaves.length; i += 500) {
    let consulta = remoto.from('base_regime').select('cnpj,raiz,regime,ano,fonte')
      .in('cnpj', chaves.slice(i, i + 500));
    if (ano) consulta = consulta.eq('ano', Number(ano));
    const { data, error } = await consulta;
    if (error) throw new Error(`Base RFB compartilhada: ${error.message}`);
    for (const r of (data || [])) {
      const atual = encontrados.get(r.cnpj);
      if (!atual || Number(r.ano) > Number(atual.ano)) encontrados.set(r.cnpj, r);
    }
  }
  // A RFB 2024 desta instalação foi publicada com CNPJ completo. Para que
  // filiais encontrem o regime da matriz, a raiz precisa ser comparada com a
  // coluna `raiz` — procurar uma raiz na coluna `cnpj` nunca encontraria nada.
  const raizes = [...new Set(chaves.filter((x) => x.length === 8))];
  for (let i = 0; i < raizes.length; i += 500) {
    let consulta = remoto.from('base_regime').select('cnpj,raiz,regime,ano,fonte')
      .in('raiz', raizes.slice(i, i + 500));
    if (ano) consulta = consulta.eq('ano', Number(ano));
    const { data, error } = await consulta;
    if (error) throw new Error(`Base RFB compartilhada: ${error.message}`);
    for (const r of (data || [])) {
      const atual = encontrados.get(r.raiz);
      if (!atual || Number(r.ano) > Number(atual.ano)) encontrados.set(r.raiz, r);
    }
  }
  return encontrados;
}

async function refinarParceiros(empresaId, opcoes = {}) {
  const D = db();
  const alvos = D.prepare(`SELECT id, cnpj, descricao, regime, origem FROM parceiros
    WHERE empresa_id = ? AND cnpj <> ''
      AND (regime = 'regime_regular' OR regime IS NULL OR regime = '')
      AND origem <> 'manual'`).all(empresaId);

  const up = D.prepare(`UPDATE parceiros SET regime = ?, origem = 'base_receita' WHERE id = ?`);
  const rel = { alvos: alvos.length, refinados: 0, semCorrespondencia: 0, porRegime: {}, porNivel: {}, fonte: 'local' };
  const remotos = await consultarCompartilhada(alvos.map((p) => p.cnpj), opcoes.ano);
  if (remotos.size) rel.fonte = 'Supabase (RFB compartilhada)';

  D.transaction(() => {
    for (const p of alvos) {
      const cnpj = soDigitos(p.cnpj);
      // A fonte compartilhada tem precedência: ela é a mesma para todos os
      // projetos. A cópia SQLite só atende instalações sem Supabase.
      const remoto = remotos.get(cnpj) || remotos.get(cnpj.slice(0, 8));
      const r = remoto ? { ...remoto, nivel: remoto.cnpj === cnpj ? 'cnpj' : 'raiz' }
        : consultar(p.cnpj, opcoes.ano);
      if (!r) { rel.semCorrespondencia++; continue; }
      up.run(r.regime, p.id);
      rel.refinados++;
      rel.porRegime[r.regime] = (rel.porRegime[r.regime] || 0) + 1;
      rel.porNivel[r.nivel] = (rel.porNivel[r.nivel] || 0) + 1;
    }
  })();

  try {
    D.prepare(`UPDATE movimentos SET regime = (
        SELECT p.regime FROM parceiros p
        WHERE p.empresa_id = movimentos.empresa_id AND p.tipo = movimentos.tipo
          AND p.cnpj = movimentos.inscr_federal)
      WHERE empresa_id = ? AND inscr_federal <> ''`).run(empresaId);
  } catch (_) { /* segue */ }
  return rel;
}

async function estatisticas() {
  const D = db();
  const porRegime = D.prepare(`SELECT regime, ano, COUNT(*) c FROM base_regime
    GROUP BY regime, ano ORDER BY ano DESC, regime`).all();
  const total = D.prepare('SELECT COUNT(*) c FROM base_regime').get().c;
  const importacoes = D.prepare('SELECT * FROM base_regime_importacoes ORDER BY id DESC LIMIT 10').all();
  let totalCompartilhado = null;
  if (supabase.configurado()) {
    const { count, error } = await supabase.admin().from('base_regime')
      .select('*', { count: 'exact', head: true });
    if (!error) totalCompartilhado = count || 0;
  }
  return { total: totalCompartilhado ?? total, totalLocal: total, totalCompartilhado, porRegime, importacoes,
    regimesAceitos: Object.entries(REGIMES_VALIDOS).map(([k, v]) => ({ chave: k, nome: v })) };
}

function limpar(regime, ano) {
  const D = db();
  if (regime && ano) return D.prepare('DELETE FROM base_regime WHERE regime = ? AND ano = ?').run(regime, ano).changes;
  if (regime) return D.prepare('DELETE FROM base_regime WHERE regime = ?').run(regime).changes;
  return D.prepare('DELETE FROM base_regime').run().changes;
}

module.exports = { detectar, importar, regimePorTexto, consultar, consultarCompartilhada, refinarParceiros, estatisticas, limpar, REGIMES_VALIDOS };

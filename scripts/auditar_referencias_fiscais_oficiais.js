/*
 * Reconcilia as chaves fiscais presentes nos movimentos com a camada de
 * referências oficiais. É estritamente somente-leitura: não toca no catálogo
 * operacional, regras, resultados ou motor.
 */
const db = require('../src/db');
const { normalizarNcm, normalizarNbs, normalizarLc116 } = require('../src/services/referenciasFiscaisOficiais');

const porDominio = Object.fromEntries(db.prepare(`
  SELECT dominio, COUNT(*) AS referencias
  FROM referencias_fiscais_oficiais
  WHERE situacao='VIGENTE'
  GROUP BY dominio
`).all().map((x) => [x.dominio, Number(x.referencias)]));

const movimentos = db.prepare(`
  SELECT id, ncm, nbs, lc116
  FROM movimentos
`).all();

function auditarDominio(dominio, coluna, normalizar) {
  const referencias = new Set(db.prepare(`
    SELECT codigo FROM referencias_fiscais_oficiais
    WHERE dominio=? AND situacao='VIGENTE'
  `).all(dominio).map((x) => x.codigo));
  const grupos = new Map();
  for (const movimento of movimentos) {
    const original = movimento[coluna];
    if (original == null || String(original).trim() === '') continue;
    const codigo = normalizar(original);
    if (!grupos.has(codigo)) grupos.set(codigo, []);
    grupos.get(codigo).push(movimento.id);
  }
  const chaves = [...grupos.entries()].map(([codigo, ids]) => ({
    codigo, operacoes: ids.length, ids, referencia_oficial: referencias.has(codigo) ? 'SIM' : 'NAO',
  })).sort((a, b) => a.codigo.localeCompare(b.codigo));
  return {
    movimentos_com_chave: chaves.reduce((total, x) => total + x.operacoes, 0),
    chaves_distintas: chaves.length,
    com_referencia: chaves.filter((x) => x.referencia_oficial === 'SIM').reduce((total, x) => total + x.operacoes, 0),
    sem_referencia: chaves.filter((x) => x.referencia_oficial === 'NAO'),
    chaves,
  };
}

const relacoesNbsLc116 = Number(db.prepare(`
  SELECT COUNT(*) AS total FROM referencias_fiscais_relacoes WHERE tipo='NBS_LC116'
`).get().total);

const paresNbsLc116 = (() => {
  const paresOficiais = new Set(db.prepare(`
    SELECT nbs.codigo AS nbs, lc116.codigo AS lc116
    FROM referencias_fiscais_relacoes r
    JOIN referencias_fiscais_oficiais nbs ON nbs.id=r.origem_id
    JOIN referencias_fiscais_oficiais lc116 ON lc116.id=r.destino_id
    WHERE r.tipo='NBS_LC116'
  `).all().map((x) => `${x.nbs}:${x.lc116}`));
  const grupos = new Map();
  for (const movimento of movimentos) {
    if (movimento.nbs == null || String(movimento.nbs).trim() === '' || movimento.lc116 == null || String(movimento.lc116).trim() === '') continue;
    const nbs = normalizarNbs(movimento.nbs);
    const lc116 = normalizarLc116(movimento.lc116);
    const chave = `${nbs}:${lc116}`;
    if (!grupos.has(chave)) grupos.set(chave, { nbs, lc116, operacoes: 0, ids: [] });
    const atual = grupos.get(chave);
    atual.operacoes += 1;
    atual.ids.push(movimento.id);
  }
  const chaves = [...grupos.values()].map((x) => ({ ...x, relacao_oficial: paresOficiais.has(`${x.nbs}:${x.lc116}`) ? 'SIM' : 'NAO' }));
  return {
    movimentos_com_ambas_chaves: chaves.reduce((soma, x) => soma + x.operacoes, 0),
    movimentos_com_par_oficial: chaves.filter((x) => x.relacao_oficial === 'SIM').reduce((soma, x) => soma + x.operacoes, 0),
    pares_divergentes: chaves.filter((x) => x.relacao_oficial === 'NAO').sort((a, b) => b.operacoes - a.operacoes),
  };
})();

const relatorio = {
  finalidade: 'Somente leitura. Nenhuma regra, resultado, catálogo operacional ou motor foi alterado.',
  referencias_vigentes: porDominio,
  ncm: auditarDominio('NCM', 'ncm', normalizarNcm),
  nbs: auditarDominio('NBS', 'nbs', normalizarNbs),
  lc116: auditarDominio('LC116', 'lc116', normalizarLc116),
  relacoes_nbs_lc116_oficiais: relacoesNbsLc116,
  pares_nbs_lc116_movimentos: paresNbsLc116,
  observacao: relacoesNbsLc116 === 0
    ? 'Nenhuma correlação NBS–LC116 foi inferida ou criada; a relação depende de fonte oficial explícita.'
    : 'Apenas relações com fonte oficial explícita são consideradas.',
};
console.log(JSON.stringify(relatorio, null, 2));
db.close();

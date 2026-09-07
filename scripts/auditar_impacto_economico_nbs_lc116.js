/*
 * Auditoria somente-leitura das divergências documentais NBS–LC116.
 * Não recalcula, não grava e não promove classificações. A pergunta é
 * estritamente material: a associação oficial disponibiliza cClassTrib CBS
 * diferente do resultado já produzido pelo motor?
 */
const db = require('../src/db');
const motor = require('../src/engine/motor');
const { normalizar } = require('../src/services/motorExec');
const elegibilidadeAnexoXi = require('../src/services/elegibilidadeAnexoXi');
const { normalizarNbs, normalizarLc116 } = require('../src/services/referenciasFiscaisOficiais');

const paresOficiais = new Map();
for (const linha of db.prepare(`
  SELECT nbs.codigo AS nbs, lc.codigo AS lc116
  FROM referencias_fiscais_relacoes r
  JOIN referencias_fiscais_oficiais nbs ON nbs.id=r.origem_id
  JOIN referencias_fiscais_oficiais lc ON lc.id=r.destino_id
  WHERE r.tipo='NBS_LC116'
`).all()) {
  if (!paresOficiais.has(linha.nbs)) paresOficiais.set(linha.nbs, new Set());
  paresOficiais.get(linha.nbs).add(linha.lc116);
}

const movimentos = db.prepare(`
  SELECT m.*, p.regime AS regime_cadastro, p.perfil_economico AS perfil_cadastro
  FROM movimentos m
  LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo AND p.cnpj=m.inscr_federal
  WHERE COALESCE(m.nbs,'')<>'' AND COALESCE(m.lc116,'')<>''
`).all();
const empresas = new Map();
const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '');
function empresa(id) {
  if (!empresas.has(id)) empresas.set(id, db.prepare('SELECT * FROM empresas WHERE id=?').get(id));
  return empresas.get(id);
}
function naturezaAdquirente(cnpj) {
  return elegibilidadeAnexoXi.naturezaAdquirente(db.prepare('SELECT * FROM cnpj_cache WHERE cnpj=?')
    .get(somenteDigitos(cnpj)) || {});
}
function contextoSombra(movimento) {
  const emp = empresa(movimento.empresa_id);
  const regime = movimento.regime_cadastro || movimento.regime || null;
  if (movimento.tipo === 'cliente') {
    const destinatario = movimento.perfil_cadastro === 'governo'
      ? { perfil: 'governo' }
      : motor.classificarDestinatario({ regime, cnpj: movimento.inscr_federal });
    return { empresa: emp, sentido: 'saida', ano: 2027, regimeContraparte: regime,
      perfilDestinatario: destinatario.perfil,
      elegibilidadeAnexoXi: { qsa: elegibilidadeAnexoXi.qsaEmpresa(movimento.empresa_id), adquirente: naturezaAdquirente(movimento.inscr_federal) } };
  }
  return { empresa: emp, sentido: 'entrada', ano: 2027, regimeContraparte: regime,
    elegibilidadeAnexoXi: { qsa: { status: 'PENDENTE', motivo: 'Sombra somente-leitura para operação de entrada.' }, adquirente: naturezaAdquirente(emp?.cnpj) } };
}
function assinaturaResultado(resultado) {
  return JSON.stringify({
    cst: resultado.classificacao?.cst || '', cclasstrib: resultado.classificacao?.cclasstrib || '',
    cbs: Number(resultado.cbs || 0), credito_cbs: Number(resultado.creditoTotal || 0),
  });
}

const grupos = new Map();
for (const movimento of movimentos) {
  const nbs = normalizarNbs(movimento.nbs);
  const lc116 = normalizarLc116(movimento.lc116);
  const oficiais = paresOficiais.get(nbs) || new Set();
  if (oficiais.has(lc116)) continue;
  const chave = `${nbs}:${lc116}`;
  if (!grupos.has(chave)) grupos.set(chave, { nbs, lc116, ids: [], valor: 0 });
  const grupo = grupos.get(chave);
  grupo.ids.push(movimento.id);
  grupo.valor += Number(movimento.valor || 0);
}

const divergencias = [...grupos.values()].map((grupo) => {
  const lc116Oficiais = [...(paresOficiais.get(grupo.nbs) || [])].sort();
  const movimentosGrupo = movimentos.filter((m) => grupo.ids.includes(m.id));
  let diferencas = 0;
  let cbsAtual = 0;
  let cbsSombra = 0;
  for (const movimento of movimentosGrupo) {
    const item = normalizar(movimento);
    const contexto = contextoSombra(movimento);
    const atual = motor.projetarItem(item, contexto);
    const assinaturaAtual = assinaturaResultado(atual);
    cbsAtual += Number(atual.cbs || 0);
    for (const lc116 of lc116Oficiais) {
      const sombra = motor.projetarItem({ ...item, lc116 }, contexto);
      cbsSombra += Number(sombra.cbs || 0);
      if (assinaturaResultado(sombra) !== assinaturaAtual) diferencas += 1;
    }
  }
  let classificacao;
  if (!lc116Oficiais.length) classificacao = 'SEM_CORRELACAO_OFICIAL';
  else classificacao = diferencas === 0 ? 'SEM_EFEITO_CBS_E_CREDITO_COMPROVADO' : 'EFEITO_CBS_OU_CREDITO_OBSERVADO';
  return {
    nbs: grupo.nbs, lc116_documental: grupo.lc116, lc116_oficiais: lc116Oficiais,
    operacoes: grupo.ids.length, valor_documental: Math.round(grupo.valor * 100) / 100,
    classificacao, diferencas_observadas: diferencas,
    cbs_atual_sombra: Math.round(cbsAtual * 100) / 100,
    cbs_lc116_oficial_sombra: Math.round(cbsSombra * 100) / 100,
    ids_exemplo: grupo.ids.slice(0, 10),
  };
}).sort((a, b) => b.operacoes - a.operacoes);

const resumo = divergencias.reduce((acc, x) => {
  if (!acc[x.classificacao]) acc[x.classificacao] = { operacoes: 0, valor: 0, pares: 0 };
  acc[x.classificacao].operacoes += x.operacoes;
  acc[x.classificacao].valor += x.valor_documental;
  acc[x.classificacao].pares += 1;
  return acc;
}, {});

console.log(JSON.stringify({
  finalidade: 'Somente leitura. Não altera documentos, regras, motor, resultados, banco produtivo ou Supabase.',
  criterio: 'A mesma função produtiva de projeção é executada em memória com o LC116 documental e com cada LC116 oficial do mesmo NBS. A comparação cobre CST, cClassTrib, CBS e crédito CBS. PIS/Cofins não é inferido nesta auditoria.',
  resumo, divergencias,
}, null, 2));
db.close();

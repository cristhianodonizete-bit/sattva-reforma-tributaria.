/**
 * Motor das receitas sem documento fiscal.
 *
 * A planilha informa o fato econômico; o enquadramento CBS/IBS é sempre
 * resolvido pela matriz versionada, nunca pelo texto que o usuário digitou.
 */
const texto = (v) => String(v ?? '').trim();
const normalizar = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

function temTabela(db, nome) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(nome));
}
function dentroVigencia(regra, data) {
  return (!regra.vigencia_inicio || regra.vigencia_inicio <= data)
    && (!regra.vigencia_fim || regra.vigencia_fim >= data);
}
function resolver(db, receita, regimeEmpresa) {
  const data = `${texto(receita.competencia)}-01`;
  const regime = texto(regimeEmpresa);
  if (texto(receita.item_receita_chave) && temTabela(db, 'regras_itens_receita_regime')) {
    const regra = db.prepare(`SELECT r.*, c.nome AS item_nome, c.classificacao_fiscal
      FROM regras_itens_receita_regime r JOIN catalogo_itens_receita c ON c.chave=r.item_chave
      WHERE r.item_chave=? AND r.regime_empresa=? AND r.ativo=1
      ORDER BY r.vigencia_inicio DESC, r.id DESC`).all(receita.item_receita_chave, regime)
      .find((x) => dentroVigencia(x, data));
    if (!regra) return { status: 'PENDENTE_REGRA', pendencia: `Não há regra vigente para este item no regime ${regime || 'não identificado'}.` };
    if (Number(regra.requer_classificacao)) return { status: 'PENDENTE_CLASSIFICACAO', regra, pendencia: 'A natureza concreta do rendimento financeiro deve ser identificada antes de atribuir cClassTrib.' };
    return { status: 'DETERMINADO', regra, pendencia: null };
  }
  const classificacao = normalizar(receita.classificacao_fiscal);
  const subtipo = normalizar(receita.subtipo);
  if (!classificacao || classificacao === 'OUTRA') {
    return { status: 'PENDENTE_CLASSIFICACAO', pendencia: 'Classifique a natureza da receita antes de calcular CBS/IBS.' };
  }
  if (!temTabela(db, 'regras_receitas_sem_dfe')) {
    return { status: 'PENDENTE_CATALOGO', pendencia: 'Catálogo de regras para receitas sem DF-e ainda não está disponível.' };
  }
  const candidatas = db.prepare("SELECT * FROM regras_receitas_sem_dfe WHERE status='ATIVA' AND classificacao_fiscal=? ORDER BY prioridade DESC, versao DESC, id DESC")
    .all(classificacao)
    .filter((r) => dentroVigencia(r, data))
    .filter((r) => !texto(r.subtipo) || normalizar(r.subtipo) === subtipo);
  if (!candidatas.length) return { status: 'PENDENTE_REGRA', pendencia: `Não há regra CBS/IBS vigente catalogada para ${classificacao}${subtipo ? ` / ${subtipo}` : ''}.` };
  const primeira = candidatas[0];
  if (candidatas.length > 1 && Number(primeira.prioridade) === Number(candidatas[1].prioridade) && Number(primeira.versao) === Number(candidatas[1].versao)) {
    return { status: 'REQUER_VALIDACAO', pendencia: 'Há mais de uma regra CBS/IBS com a mesma prioridade para esta receita.', candidatas: candidatas.map((x) => x.id) };
  }
  return { status: 'DETERMINADO', regra: primeira, pendencia: null };
}
function campos(db) {
  return new Set(db.prepare('PRAGMA table_info(receitas_sem_dfe)').all().map((x) => x.name));
}
function aplicar(db, receita, regimeEmpresa) {
  const colunas = campos(db);
  if (!colunas.has('status_motor')) return { ...resolver(db, receita, regimeEmpresa), aplicado: false };
  const resultado = resolver(db, receita, regimeEmpresa);
  const regra = resultado.regra || {};
  const base = Number(receita.valor);
  const pis = Number.isFinite(base) && regra.pis_percentual !== null && regra.pis_percentual !== undefined ? base * Number(regra.pis_percentual) : null;
  const cofins = Number.isFinite(base) && regra.cofins_percentual !== null && regra.cofins_percentual !== undefined ? base * Number(regra.cofins_percentual) : null;
  db.prepare(`UPDATE receitas_sem_dfe SET status_motor=?, regra_motor_id=?, regra_motor_versao=?, regra_motor_atual=?, regra_motor_reforma=?, cst_motor=?, cclasstrib_motor=?, fundamento_motor=?, pendencia_motor=?, processado_motor_em=datetime('now','localtime'), status_comparabilidade=? WHERE id=?`)
    .run(resultado.status, regra.id || null, regra.versao || null, regra.tratamento_atual || null, regra.tratamento_reforma || null, regra.cst || null, regra.cclasstrib || null, regra.fundamento || null, resultado.pendencia || null, resultado.status === 'DETERMINADO' ? 'PRONTA_PARA_COMPARAR' : resultado.status, receita.id);
  if (resultado.status === 'DETERMINADO' && (colunas.has('pis_atual') || colunas.has('cofins_atual'))) {
    db.prepare(`UPDATE receitas_sem_dfe SET base_pis_cofins_atual=?, pis_atual=?, cofins_atual=?, criterio_tributacao_atual=?, tributacao_atual_origem=? WHERE id=?`)
      .run((pis !== null || cofins !== null) ? base : null, pis, cofins, regra.tratamento_atual || null, 'REGRA_TECNICA_POR_REGIME', receita.id);
  }
  return { ...resultado, aplicado: true };
}
function reprocessarEmpresa(db, empresaId) {
  if (!temTabela(db, 'receitas_sem_dfe') || !campos(db).has('status_motor')) return { processadas: 0, pendentes: 0 };
  const regime = db.prepare('SELECT regime FROM empresas WHERE id=?').get(empresaId)?.regime;
  const linhas = db.prepare('SELECT * FROM receitas_sem_dfe WHERE empresa_id=?').all(empresaId);
  const resultados = linhas.map((x) => aplicar(db, x, regime));
  return { processadas: resultados.length, pendentes: resultados.filter((x) => x.status !== 'DETERMINADO').length };
}
module.exports = { resolver, aplicar, reprocessarEmpresa, dentroVigencia };

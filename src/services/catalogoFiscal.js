/* Resolução única da carga atual de PIS/COFINS a partir do catálogo importado. */
const bases = require('./basesReforma');

const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const texto = (v) => String(v || '').trim();

function localizar(item) {
  const escolher = (candidatos) => {
    if (!candidatos.length) return null;
    const assinaturas = new Set(candidatos.map((c) => [c.tratamento_pis_cofins, c.tratamento_efetivo_saida,
      c.percentual_reconstrucao_sugerido, c.cumulatividade_obrigatoria, c.total_cumulativo_percentual,
      c.grau_determinacao].map(texto).join('|')));
    return assinaturas.size === 1 ? candidatos[0] : null;
  };
  const produto = String(item.ncm || '').replace(/\D/g, '');
  if (produto) {
    const r = bases.consultarNcm(produto);
    return escolher(r.candidatos || []);
  }
  const r = bases.consultarServico(item.lc116 || '', item.nbs || '');
  return escolher(r.candidatos || []);
}

function resolver(item, regime) {
  const documento = num(item.pis) + num(item.cofins);
  if (documento > 0) return { percentual: item.valor ? documento / num(item.valor) : 0, valor: documento, origem: 'DOCUMENTO', natureza: 'REAL', metodo: 'DOCUMENTO', catalogo: null };
  const c = localizar(item);
  if (!c) return { percentual: null, valor: null, origem: 'INDETERMINADO', natureza: 'INDETERMINADO', metodo: 'SEM_CATALOGO', catalogo: null };
  const tratamento = texto(c.tratamento_pis_cofins).toUpperCase();
  const efetivo = texto(c.tratamento_efetivo_saida).toUpperCase();
  const condicional = texto(c.grau_determinacao).toUpperCase().includes('CONDICIONADO');
  if (tratamento.includes('ALÍQUOTA ZERO') || efetivo.includes('ALÍQUOTA ZERO')) return { percentual: 0, valor: 0, origem: 'CATALOGO_REGRA_ESPECIFICA', natureza: 'CALCULADO', metodo: 'ALIQUOTA_ZERO', catalogo: c };
  if (tratamento.includes('MONOF')) {
    if (efetivo.includes('ALÍQUOTA ZERO')) return { percentual: 0, valor: 0, origem: 'CATALOGO_REGRA_ESPECIFICA', natureza: 'CALCULADO', metodo: 'MONOFASICO_REVENDA_ZERO', catalogo: c };
    const p = num(c.percentual_reconstrucao_sugerido);
    return p ? { percentual: p, valor: num(item.valor) * p, origem: 'PREMISSA_SIMULADA', natureza: 'SIMULADO', metodo: 'MONOFASICO_PREMISSA', catalogo: c } : { percentual: null, valor: null, origem: 'INDETERMINADO', natureza: 'INDETERMINADO', metodo: 'MONOFASICO_SEM_PAPEL', catalogo: c };
  }
  if (texto(c.cumulatividade_obrigatoria).toUpperCase() === 'SIM') {
    const p = num(c.total_cumulativo_percentual) || (num(c.pis_cumulativo_percentual) + num(c.cofins_cumulativo_percentual));
    if (condicional) return { percentual: null, valor: null, origem: 'INDETERMINADO', natureza: 'INDETERMINADO', metodo: 'CUMULATIVIDADE_CONDICIONADA', catalogo: c };
    return { percentual: p, valor: num(item.valor) * p, origem: 'CATALOGO_REGRA_ESPECIFICA', natureza: 'CALCULADO', metodo: 'CUMULATIVIDADE_OBRIGATORIA', catalogo: c };
  }
  if (item.pis_cofins_referencia !== null && item.pis_cofins_referencia !== undefined) {
    const p = num(item.pis_cofins_referencia);
    return { percentual: p, valor: num(item.valor) * p, origem: 'REFERENCIA_EMPRESA', natureza: 'CALCULADO', metodo: 'REFERENCIA_EMPRESA', catalogo: c };
  }
  const p = regime === 'lucro_real' ? 0.0925 : regime === 'lucro_presumido' ? 0.0365 : null;
  return p == null ? { percentual: null, valor: null, origem: 'INDETERMINADO', natureza: 'INDETERMINADO', metodo: 'REGIME_NAO_DEFINIDO', catalogo: c } : { percentual: p, valor: num(item.valor) * p, origem: 'REGRA_REGIME', natureza: 'CALCULADO', metodo: 'REGRA_GERAL_REGIME', catalogo: c };
}

module.exports = { localizar, resolver };

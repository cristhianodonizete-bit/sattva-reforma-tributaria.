/* Resolução única da carga atual de PIS/COFINS a partir do catálogo importado. */
const bases = require('./basesReforma');

const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const texto = (v) => String(v || '').trim();

function localizar(item) {
  // Permite que uma referência já validada pela empresa seja usada pelo
  // resolvedor sem que ela seja confundida com uma regra genérica do catálogo.
  if (item.catalogo_fiscal && typeof item.catalogo_fiscal === 'object') return item.catalogo_fiscal;
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

function candidatosDoItem(item) {
  if (item.catalogo_fiscal && typeof item.catalogo_fiscal === 'object') return [item.catalogo_fiscal];
  const produto = String(item.ncm || '').replace(/\D/g, '');
  if (produto) return bases.consultarNcm(produto).candidatos || [];
  return bases.consultarServico(item.lc116 || '', item.nbs || '').candidatos || [];
}

function motivoSemCatalogo(item) {
  const temProduto = Boolean(String(item.ncm || '').replace(/\D/g, ''));
  const temServico = Boolean(String(item.nbs || '').trim() || String(item.lc116 || '').trim());
  if (!temProduto && !temServico) return 'SEM_EVIDENCIA';
  return 'SEM_CATALOGO';
}

function resolver(item, opcoes = {}) {
  const documento = num(item.pis) + num(item.cofins);
  // Flag de bloco XML não comprova valor: zero somente vem do documento quando
  // houver evidência fiscal explícita para a alíquota zero.
  // Zero só é aceito quando foi comprovado; não é o mesmo que o valor positivo
  // destacado em XML, que a projeção pode substituir pela matriz saneada.
  if (item.pis_cofins_zero_comprovado === true || (!opcoes.ignorarDocumento && documento > 0)) return { percentual: item.valor ? documento / num(item.valor) : 0, valor: documento, origem: 'DOCUMENTO', natureza: 'REAL', metodo: 'DOCUMENTO', modoMonofasia: 'VALOR_REAL_DOCUMENTO', catalogo: null };
  const c = localizar(item);
  // Ausência de catálogo não é autorização para escolher uma carga por
  // conveniência. A regra geral de regime continua sendo uma regra válida
  // quando for chamada explicitamente pelo motor, mas não pode mascarar a
  // falta de classificação/tratamento específico desta operação.
  if (!c) return {
    percentual: null, valor: null, origem: 'INDETERMINADO', natureza: 'INDETERMINADO',
    metodo: 'SEM_CATALOGO', motivoIndeterminacao: candidatosDoItem(item).length > 1 ? 'MULTIPLOS_CANDIDATOS' : motivoSemCatalogo(item),
    candidatos: candidatosDoItem(item).map((x) => ({ id: x.id || null, ncm: x.ncm || null, nbs: x.nbs || null, cclasstrib: x.cclasstrib || null })),
    catalogo: null, continuar: item.regra_geral_regime_confirmada === true,
    justificativa: 'Não foi localizada regra fiscal conclusiva para a operação.',
  };
  const tratamento = texto(c.tratamento_pis_cofins).toUpperCase();
  const efetivo = texto(c.tratamento_efetivo_saida).toUpperCase();
  const condicional = texto(c.grau_determinacao).toUpperCase().includes('CONDICIONADO');
  if (tratamento.includes('ALÍQUOTA ZERO') || efetivo.includes('ALÍQUOTA ZERO')) return { percentual: 0, valor: 0, origem: 'CATALOGO_REGRA_ESPECIFICA', natureza: 'CALCULADO', metodo: 'ALIQUOTA_ZERO', modoMonofasia: 'ALIQUOTA_ZERO_REVENDA', catalogo: c };
  if (tratamento.includes('MONOF')) {
    if (efetivo.includes('ALÍQUOTA ZERO')) return { percentual: 0, valor: 0, origem: 'CATALOGO_REGRA_ESPECIFICA', natureza: 'CALCULADO', metodo: 'MONOFASICO_REVENDA_ZERO', modoMonofasia: 'ALIQUOTA_ZERO_REVENDA', catalogo: c };
    const p = num(c.percentual_reconstrucao_sugerido);
    return p ? { percentual: p, valor: num(item.valor) * p, origem: 'PREMISSA_SIMULADA', natureza: 'SIMULADO', metodo: 'MONOFASICO_PREMISSA', modoMonofasia: 'PREMISSA_PERCENTUAL', catalogo: c } : { percentual: null, valor: null, origem: 'INDETERMINADO', natureza: 'INDETERMINADO', metodo: 'MONOFASICO_SEM_PAPEL', modoMonofasia: 'INDETERMINADO', catalogo: c, continuar: false, condicaoMaterial: true };
  }
  if (texto(c.cumulatividade_obrigatoria).toUpperCase() === 'SIM') {
    const p = num(c.total_cumulativo_percentual) || (num(c.pis_cumulativo_percentual) + num(c.cofins_cumulativo_percentual));
    if (condicional) {
      // A mera condição do catálogo não equivale a alíquota zero. Somente uma
      // evidência explícita de que a condição pendente impede o fallback pode
      // encerrar a precedência. Nos demais casos a empresa/regime ainda pode
      // resolver a operação residual.
      const condicao = texto(c.condicao_cumulatividade || c.regra_precedencia).toUpperCase();
      const condicaoMaterial = item.condicao_material_pendente === true || /IMPEDIMENTO\s+MATERIAL|BLOQUEIA[_ ]FALLBACK/.test(condicao);
      return { percentual: null, valor: null, origem: 'INDETERMINADO', natureza: 'INDETERMINADO', metodo: 'CUMULATIVIDADE_CONDICIONADA', motivoIndeterminacao: condicaoMaterial ? 'REGRA_INCONCLUSIVA' : 'SEM_REGRA_APLICAVEL', catalogo: c, continuar: !condicaoMaterial, condicaoMaterial,
        justificativa: condicaoMaterial ? `Condição material pendente: ${c.condicao_cumulatividade || c.regra_precedencia || 'não informada'}.` : 'Catálogo condicional sem impedimento material explícito; seguir para a regra validada da empresa/regime.' };
    }
    return { percentual: p, valor: num(item.valor) * p, origem: 'CATALOGO_REGRA_ESPECIFICA', natureza: 'CALCULADO', metodo: 'CUMULATIVIDADE_OBRIGATORIA', catalogo: c };
  }
  // Referência da empresa e regra do regime são deliberadamente resolvidas no
  // motor, após o catálogo: assim permanecem versionadas no cadastro central.
  return {
    percentual: null, valor: null, origem: 'INDETERMINADO', natureza: 'INDETERMINADO',
    metodo: 'CATALOGO_SEM_REGRA_CONCLUSIVA', motivoIndeterminacao: 'REGRA_INCONCLUSIVA',
    // A ausência de regra específica não é exceção fiscal. Quando o contexto
    // confirmou a regra geral versionada do regime, ela é a próxima
    // precedência; uma regra específica conclusiva continua prevalecendo.
    catalogo: c, continuar: item.regra_geral_regime_confirmada === true,
    justificativa: 'O catálogo foi localizado, mas não contém regra específica conclusiva aplicável à operação.',
  };
}

module.exports = { localizar, resolver, motivoSemCatalogo, candidatosDoItem };

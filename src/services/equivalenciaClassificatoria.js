const crypto = require('crypto');
const { construirAssinaturaCBS, compararAssinaturasCBS } = require('./assinaturaTributariaCBS');

const texto = (valor) => String(valor ?? '').trim();
const versoesCatalogo = (candidatos) => [...new Set(candidatos.map((c) => c.catalogo_versao_id || c.catalogoVersao || c.versao_catalogo || null).filter(Boolean))];
function cstDoCandidato(candidato) {
  const cst = texto(candidato?.cst);
  if (cst) return cst;
  const grupo = texto(candidato?.cclasstrib).slice(0, 3);
  return ['000', '200', '400', '410'].includes(grupo) ? grupo : '';
}

// Compara somente materialidade. Não escolhe NCM/NBS/cClassTrib individual.
function avaliarEquivalenciaClassificatoria(candidatos, contexto = {}) {
  const validos = (candidatos || []).filter(Boolean);
  if (validos.length < 2) return { status: 'NAO_APLICAVEL', impacto_tributario_material: null, candidatos: validos.length };
  if (validos.some((c) => !cstDoCandidato(c) || !texto(c.cclasstrib))) return { status: 'INDETERMINADA', impacto_tributario_material: null, candidatos: validos.length, motivo: 'Há candidato sem dados materiais suficientes para compor a assinatura tributária.' };
  const assinaturas = validos.map((c) => ({
    candidato: { ncm: texto(c.ncm) || null, nbs: texto(c.nbs) || null, cclasstrib: texto(c.cclasstrib) || null },
    assinatura: construirAssinaturaCBS({ codigo: cstDoCandidato(c), ...c }, { codigo: c.cclasstrib || null, ...c }, contexto),
  }));
  const comparacao = compararAssinaturasCBS(assinaturas.map((x) => x.assinatura));
  const decisao = { status: comparacao, impacto_tributario_material: comparacao === 'EQUIVALENTE_FISCALMENTE' ? false : true, candidatos: assinaturas.map((x) => x.candidato), assinaturas: assinaturas.map((x) => x.assinatura.hash_assinatura_material), catalogo_versoes: versoesCatalogo(validos), regra: 'EQUIVALENCIA_CLASSIFICATORIA_MATERIAL_V1', origem: 'CATALOGO_CLASSIFICATORIO' };
  decisao.hash_decisao = crypto.createHash('sha256').update(JSON.stringify(decisao)).digest('hex');
  return decisao;
}

module.exports = { avaliarEquivalenciaClassificatoria };

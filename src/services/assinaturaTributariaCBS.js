const crypto = require('crypto');

const normalizar = (valor) => String(valor ?? '').trim().toUpperCase();
const bool = (valor) => valor === true || valor === 1 || valor === '1' || valor === 'true';

/**
 * Assinatura de equivalência tributária CBS para auditoria de candidatos.
 * Não resolve classificação nem altera qualquer resultado do motor.
 */
function construirAssinaturaCBS(cst, cclasstrib, contexto = {}) {
  const material = {
    cst: normalizar(cst?.codigo ?? cclasstrib?.cst_codigo_origem),
    cclasstrib: normalizar(cclasstrib?.codigo),
    tipo_aliquota: normalizar(cclasstrib?.tipo_aliquota),
    pred_cbs: String(cclasstrib?.pred_cbs ?? ''),
    ind_gtrib_regular: bool(cclasstrib?.ind_gtrib_regular),
    ind_gred: bool(cst?.ind_gred),
    ind_gdif: bool(cst?.ind_gdif),
    ind_gibs_cbs_mono: bool(cst?.ind_gibs_cbs_mono),
    ind_gtransf_cred: bool(cst?.ind_gtransf_cred),
    ind_redutor_bc: bool(cst?.ind_redutor_bc),
    ind_gcred_pres_op: bool(cclasstrib?.ind_gcred_pres_op),
    ind_gmono_padrao: bool(cclasstrib?.ind_gmono_padrao),
    ind_gmono_reten: bool(cclasstrib?.ind_gmono_reten),
    ind_gmono_ret: bool(cclasstrib?.ind_gmono_ret),
    ind_gmono_dif: bool(cclasstrib?.ind_gmono_dif),
    ind_gestorno_cred: bool(cclasstrib?.ind_gestorno_cred),
    contexto_operacao: normalizar(contexto.tipo_operacao),
    contexto_destinacao: normalizar(contexto.destinacao)
  };
  const canonica = JSON.stringify(Object.keys(material).sort().reduce((out, chave) => {
    out[chave] = material[chave];
    return out;
  }, {}));
  return {
    assinatura_documento: {
      cst_documento: contexto.cst_documento ?? null,
      cclasstrib_documento: contexto.cclasstrib_documento ?? null
    },
    assinatura_material: material,
    hash_assinatura_material: crypto.createHash('sha256').update(canonica).digest('hex')
  };
}

function compararAssinaturasCBS(assinaturas) {
  const hashes = new Set(assinaturas.map((assinatura) => assinatura.hash_assinatura_material));
  return hashes.size === 1 ? 'EQUIVALENTE_FISCALMENTE' : 'DIVERGENTE_FISCALMENTE';
}

module.exports = { construirAssinaturaCBS, compararAssinaturasCBS };

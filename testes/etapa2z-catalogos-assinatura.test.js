const assert = require('assert');
const { construirAssinaturaCBS, compararAssinaturasCBS } = require('../src/services/assinaturaTributariaCBS');

const cst = { codigo: '000', ind_gred: false, ind_gdif: false, ind_gibs_cbs_mono: false, ind_gtransf_cred: false, ind_redutor_bc: false };
const comum = { codigo: '000001', cst_codigo_origem: '000', tipo_aliquota: 'Padrão', pred_cbs: 0, ind_gtrib_regular: false, ind_gcred_pres_op: false, ind_gmono_padrao: false, ind_gmono_reten: false, ind_gmono_ret: false, ind_gmono_dif: false, ind_gestorno_cred: false };
const a = construirAssinaturaCBS(cst, comum, { cst_documento: '000', cclasstrib_documento: '000001' });
const b = construirAssinaturaCBS(cst, { ...comum, codigo: '000002' }, { cst_documento: '000', cclasstrib_documento: '000002' });
assert.equal(compararAssinaturasCBS([a, b]), 'DIVERGENTE_FISCALMENTE', 'cClassTrib integra a assinatura material auditável');
const c = construirAssinaturaCBS(cst, comum, { cst_documento: '999', cclasstrib_documento: '999999' });
assert.equal(a.hash_assinatura_material, c.hash_assinatura_material, 'assinatura documental não altera equivalência material');
assert.deepEqual(a.assinatura_documento, { cst_documento: '000', cclasstrib_documento: '000001' });
console.log('OK etapa 2Z: assinatura CBS é determinística, auditável e não resolve classificação.');

const db = require('../db');
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const texto = (v) => String(v == null ? '' : v).trim() || null;

function normalizar({ empresa_id, movimento_id, lote_origem_id = null, hash_lineage = null, movimento = {}, xml = {} }) {
  const temPis = xml.pis_cofins_documentado === true;
  return {
    empresa_id, movimento_id, tipo_fonte: 'XML_DFE', lote_origem_id, hash_lineage,
    numero_documento: texto(movimento.documento), serie: null,
    cst_pis: texto(xml.cst_pis), cst_cofins: texto(xml.cst_cofins),
    base_pis: n(xml.base_pis), base_cofins: n(xml.base_cofins),
    aliquota_pis: n(xml.aliquota_pis), aliquota_cofins: n(xml.aliquota_cofins),
    pis_documentado: temPis ? n(xml.pis) : null, cofins_documentada: temPis ? n(xml.cofins) : null,
    origem_evidencia: 'XML_DFE', status_validacao: temPis ? 'VALIDADA' : 'INCOMPLETA', grau_confianca: 'ALTA',
  };
}

function persistir(e) {
  db.prepare(`INSERT INTO enriquecimento_pis_cofins_evidencias
    (empresa_id,movimento_id,pis_documentado,cofins_documentada,cst_pis,cst_cofins,origem_evidencia,status_validacao,tipo_fonte,lote_origem_id,hash_lineage,numero_documento,serie,base_pis,base_cofins,aliquota_pis,aliquota_cofins,grau_confianca)
    VALUES (@empresa_id,@movimento_id,@pis_documentado,@cofins_documentada,@cst_pis,@cst_cofins,@origem_evidencia,@status_validacao,@tipo_fonte,@lote_origem_id,@hash_lineage,@numero_documento,@serie,@base_pis,@base_cofins,@aliquota_pis,@aliquota_cofins,@grau_confianca)
    ON CONFLICT(empresa_id,movimento_id,origem_evidencia) DO UPDATE SET hash_lineage=excluded.hash_lineage,status_validacao=excluded.status_validacao`).run(e);
}
module.exports = { normalizar, persistir };

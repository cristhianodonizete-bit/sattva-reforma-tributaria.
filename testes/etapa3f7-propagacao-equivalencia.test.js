const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-etapa3f7-'));

const db = require('../src/db');
const catalogoFiscal = require('../src/services/catalogoFiscal');
const { avaliarCredito, contextoAposEquivalencia, projetarItem } = require('../src/engine/motor');

// Duas NBS preservadas como candidatas: mesma assinatura material e mesma
// regra de PIS/Cofins. O teste não escolhe nem grava uma NBS no documento.
for (const nbs of ['115012000', '115012100']) {
  db.prepare(`INSERT INTO base_servicos
    (lc116,nbs,cclasstrib,tratamento_pis_cofins,cumulatividade_obrigatoria,
     total_cumulativo_percentual,grau_determinacao)
    VALUES (?,?,?,?,?,?,?)`).run('0107', nbs, '000001', 'NORMAL', 'SIM', 0.0365, 'DETERMINADO');
}

const equivalencia = {
  status: 'EQUIVALENTE_FISCALMENTE', impacto_tributario_material: false,
  regra: 'EQUIVALENCIA_CLASSIFICATORIA_MATERIAL_V1', hash_decisao: 'hash-equivalente',
  catalogo_versoes: [101], origem: 'CATALOGO_CLASSIFICATORIO',
};
const clsEquivalente = { status: 'PARCIAL', equivalenciaFiscal: equivalencia };
const fato = { valor: 100, cst: '010701', cfop: '5102' };
const contexto = contextoAposEquivalencia(fato, clsEquivalente);

assert.equal(contexto.equivalente, true);
assert.equal(contexto.item.lc116, '0107');
assert.equal(contexto.item.nbs, undefined, 'A equivalência não escolhe NBS.');
assert.equal(fato.lc116, undefined, 'O fato original permanece imutável.');

const regraFiscal = catalogoFiscal.resolver(contexto.item);
assert.equal(regraFiscal.metodo, 'CUMULATIVIDADE_OBRIGATORIA');
assert.equal(regraFiscal.percentual, 0.0365);

const credito = avaliarCredito({
  regimeAdquirente: 'lucro_real', regimeFornecedor: 'lucro_real',
  cls: { status: 'REQUER_VALIDACAO', equivalenciaFiscal: equivalencia },
  decisaoClassificatoria: contexto.decisao,
});
assert.equal(credito.statusDeterminacao, 'DETERMINADO');

const projetado = projetarItem(fato, {
  sentido: 'entrada', ano: 2027, empresa: { regime: 'lucro_presumido' }, regimeContraparte: 'lucro_real',
});
assert.equal(projetado.classificacao.status, 'PARCIAL');
assert.equal(projetado.reconstrucao.memoriaPisCofins.base_reconstrucao_metodo, 'CUMULATIVIDADE_OBRIGATORIA');
assert.equal(projetado.credito.statusDeterminacao, 'DETERMINADO');

const material = contextoAposEquivalencia(fato, {
  status: 'REQUER_VALIDACAO', equivalenciaFiscal: { status: 'DIVERGENTE_FISCALMENTE', impacto_tributario_material: true },
});
assert.equal(material.equivalente, false);
assert.equal(avaliarCredito({ regimeAdquirente: 'lucro_real', regimeFornecedor: 'lucro_real', cls: { status: 'REQUER_VALIDACAO' }, decisaoClassificatoria: material.decisao }).statusDeterminacao, 'SUJEITO_VALIDACAO');

const indeterminada = contextoAposEquivalencia(fato, {
  status: 'REQUER_VALIDACAO', equivalenciaFiscal: { status: 'INDETERMINADA', impacto_tributario_material: null },
});
assert.equal(indeterminada.equivalente, false);
assert.equal(avaliarCredito({ regimeAdquirente: 'lucro_real', regimeFornecedor: 'lucro_real', cls: { status: 'REQUER_VALIDACAO' }, decisaoClassificatoria: indeterminada.decisao }).statusDeterminacao, 'SUJEITO_VALIDACAO');

console.log('Etapa 3F.7 — propagação de equivalência: OK');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-etapa3f3-'));
const { avaliarCredito, projetarItem } = require('../src/engine/motor');

const pendente = { status: 'REQUER_VALIDACAO', vedacaoPossivel: false };
const equivalente = {
  impactoTributarioMaterial: false,
  classificacaoFiscalmenteEquivalente: true,
  autonomiaClassificatoria: 'PARCIAL',
};

// Candidatos equivalentes, com decisão rastreável, seguem a regra existente
// do crédito; não há presunção baseada em perfil comercial.
const liberado = avaliarCredito({
  regimeAdquirente: 'lucro_real', regimeFornecedor: 'lucro_real', cls: pendente,
  decisaoClassificatoria: equivalente,
});
assert.deepEqual([liberado.status, liberado.statusDeterminacao, liberado.tipoCredito], ['PROJETADO', 'DETERMINADO', 'NORMAL']);

const parcialSemImpacto = avaliarCredito({
  regimeAdquirente: 'regime_regular', regimeFornecedor: 'lucro_real', cls: pendente,
  decisaoClassificatoria: { impactoTributarioMaterial: false, autonomiaClassificatoria: 'PARCIAL' },
});
assert.equal(parcialSemImpacto.statusDeterminacao, 'DETERMINADO');

// Divergência material continua bloqueada, mesmo com contraparte regular.
const bloqueado = avaliarCredito({
  regimeAdquirente: 'lucro_real', regimeFornecedor: 'lucro_real', cls: pendente,
  decisaoClassificatoria: { impactoTributarioMaterial: true, classificacaoFiscalmenteEquivalente: true, autonomiaClassificatoria: 'PARCIAL' },
});
assert.equal(bloqueado.statusDeterminacao, 'SUJEITO_VALIDACAO');

// Sem regra de crédito aplicável, a decisão classificatória não cria crédito.
const semRegime = avaliarCredito({
  regimeAdquirente: null, regimeFornecedor: 'lucro_real', cls: pendente,
  decisaoClassificatoria: equivalente,
});
assert.equal(semRegime.statusDeterminacao, 'INDETERMINADO');

// A decisão de crédito do cliente não participa do débito CBS próprio.
const item = { valor: 1000, valor_total: 1000, cfop: '5102', descricao: 'Serviço de teste', cst: '000' };
const contexto = { sentido: 'saida', ano: 2027, empresa: { regime: 'lucro_real' }, regimeContraparte: 'lucro_real' };
const antes = projetarItem(item, contexto);
const depois = projetarItem(item, { ...contexto, decisaoClassificatoria: equivalente });
assert.equal(depois.cbs, antes.cbs);

console.log('Etapa 3F.3: crédito do cliente com classificação não material aprovado.');

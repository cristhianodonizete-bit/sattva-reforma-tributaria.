#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-cadeia-200044-'));
const { leitura200044, leituraBeneficio } = require('../src/services/consolidacaoOficial');

const linhaConfirmada = {
  movimento_id: 13,
  documento: '26000/26000000000673',
  competencia: '2026-02',
  nome: 'Cliente de teste',
  inscr_federal: '12345678000195',
  descricao: 'Serviço elegível',
  nbs: '115012000',
  preco_atual: 1000,
  base_economica: 1000,
  cbs: 36.84,
  detalhe: {
    aliquotas: { cbs: 0.03684, aliquotaReferencia: { cbs: 0.0921 } },
    classificacao: {
      cclasstrib: '200044', reducaoCbs: 0.6, anexo: 'XI',
      fundamentoLegal: 'Fundamento versionado de teste',
      candidatos: [{ cclasstrib: '200044', lc116: '1.06', nbs: '115012000' }],
      elegibilidadeAnexoXi: {
        status_qsa: 'SIM', motivo: 'Sócio brasileiro com participação suficiente.',
        socio: { nome: 'Sócio brasileiro', brasileiro: 1, percentual_participacao: 20, fonte: 'cadastro' },
      },
    },
  },
};

const leitura = leitura200044(linhaConfirmada);
assert.ok(leitura, '200044 confirmado deve aparecer na leitura da cadeia');
assert.equal(leitura.reducaoCbs, 0.6);
assert.equal(leitura.aliquotaCbsReferencia, 0.0921);
assert.equal(leitura.aliquotaCbsEfetiva, 0.03684);
assert.equal(leitura.diferencaReducaoCbs, 55.26);
assert.equal(leitura.qsa.participacao, 20);
assert.equal(leitura.lc116, '1.06');
assert.equal(leitura200044({ ...linhaConfirmada, detalhe: { ...linhaConfirmada.detalhe, classificacao: { ...linhaConfirmada.detalhe.classificacao, elegibilidadeAnexoXi: { status_qsa: 'PENDENTE' } } } }), null,
  'QSA pendente nunca deve ser exibido como redução confirmada');

const aliquotaZero = leituraBeneficio({
  ...linhaConfirmada,
  movimento_id: 14,
  cbs: 0,
  detalhe: {
    ...linhaConfirmada.detalhe,
    aliquotas: { cbs: 0, aliquotaReferencia: { cbs: 0.0921 } },
    classificacao: { cclasstrib: '100001', reducaoCbs: 1, fundamentoLegal: 'Alíquota zero versionada' },
  },
});
assert.ok(aliquotaZero, 'alíquota zero efetivamente aplicada deve aparecer como benefício');
assert.equal(aliquotaZero.beneficio, 'Alíquota zero');
assert.equal(aliquotaZero.cclasstrib, '100001');
assert.equal(leituraBeneficio({ ...linhaConfirmada, status_classificacao: 'REQUER_VALIDACAO' }), null,
  'candidato pendente nunca deve aparecer como benefício aplicado');

console.log('cadeia-beneficios: leitura confirmada, alíquota zero e pendência separadas: OK');

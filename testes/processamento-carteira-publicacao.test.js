'use strict';
const assert=require('node:assert/strict');
const {exigePublicacaoFotografia}=require('../src/services/tipoProcessamentoMotor');

assert.equal(exigePublicacaoFotografia('MOTOR_COMPLETO'),true);
assert.equal(exigePublicacaoFotografia('RECALCULO_INCREMENTAL'),true,
  'recalcular projeto não pode encerrar sem publicar a fotografia oficial');
assert.equal(exigePublicacaoFotografia('MOTOR_INCREMENTAL'),false,
  'o incremental por recorte usa o fluxo específico de promoção incremental');
console.log('PASS tipos de recálculo integral exigem publicação da fotografia oficial.');

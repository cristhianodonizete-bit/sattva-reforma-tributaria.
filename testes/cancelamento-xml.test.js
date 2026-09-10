const assert = require('node:assert/strict');
const xml = require('../src/services/importadorXml');
const receita = require('../src/services/receitaOperacional');

const eventoNfe = `<?xml version="1.0"?><procEventoNFe><evento><infEvento><tpEvento>110111</tpEvento><chNFe>31260112345678000199550010000000011000000010</chNFe><dhEvento>2026-01-10T12:00:00-03:00</dhEvento></infEvento></evento><retEvento><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo></infEvento></retEvento></procEventoNFe>`;
const cancelamento = xml.lerXml(eventoNfe, '12345678000199');
assert.equal(cancelamento.tipoDocumento, 'cancelamento');
assert.equal(cancelamento.cancelamento.tipoDocumento, 'nfe');
assert.equal(cancelamento.cancelamento.chave.length, 44);
assert.equal(receita.compoeReceita({ tipo:'cliente', sentido:'saida', modelo_documento_fiscal:'nfe', cfop:'5102', situacao_documento:'CANCELADO' }), false);

const eventoNfse = `<CancelamentoNfse><PedidoCancelamento><InfPedidoCancelamento><NumeroNfse>987</NumeroNfse><CodigoVerificacao>ABC-123</CodigoVerificacao><MotivoCancelamento>Erro na emissão</MotivoCancelamento></InfPedidoCancelamento></PedidoCancelamento></CancelamentoNfse>`;
const nfse = xml.lerXml(eventoNfse, '12345678000199');
assert.equal(nfse.tipoDocumento, 'cancelamento');
assert.equal(nfse.cancelamento.tipoDocumento, 'nfse');
assert.equal(nfse.cancelamento.documento, '987');
console.log('ok cancelamento XML');

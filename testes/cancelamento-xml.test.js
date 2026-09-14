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

const nfeComFrete = `<nfeProc><NFe><infNFe Id="NFe31260112345678000199550010000000011000000010"><ide><mod>55</mod><serie>1</serie><nNF>1</nNF><dhEmi>2026-01-10T12:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>12345678000199</CNPJ><xNome>Emitente</xNome></emit><dest><CNPJ>99887766000155</CNPJ><xNome>Cliente</xNome></dest><det nItem="1"><prod><cProd>A</cProd><xProd>Produto</xProd><NCM>12345678</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vProd>100.00</vProd></prod><imposto/></det><total><ICMSTot><vNF>120.00</vNF><vFrete>20.00</vFrete></ICMSTot></total></infNFe></NFe></nfeProc>`;
const comFrete = xml.lerXml(nfeComFrete, '12345678000199');
assert.equal(comFrete.itens[0].valor_produto, 100);
assert.equal(comFrete.itens[0].frete, 20);
assert.equal(comFrete.itens[0].valor, 120);

const nfeCanceladaNoProtocolo = `<nfeProc><NFe><infNFe Id="NFe31260112345678000199550010000000011000000010"><ide><mod>55</mod><serie>1</serie><nNF>1</nNF></ide></infNFe></NFe><protNFe><infProt><cStat>101</cStat></infProt></protNFe></nfeProc>`;
const canceladaNoProtocolo = xml.lerXml(nfeCanceladaNoProtocolo, '12345678000199');
assert.equal(canceladaNoProtocolo.tipoDocumento, 'cancelamento');
assert.equal(canceladaNoProtocolo.cancelamento.chave.length, 44);
console.log('ok cancelamento XML');

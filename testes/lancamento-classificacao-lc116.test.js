const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-lc116-lancamento-'));
process.env.SATTVA_DADOS = dir;

const xml = require('../src/services/importadorXml');
const db = require('../src/db');
const bases = require('../src/services/basesReforma');
const normalizacao = require('../src/services/normalizacaoFiscalXml');
const motorExec = require('../src/services/motorExec');
const { classificar } = require('../src/engine/classificador');

// O item da lista de serviços não pode mais ser confundido com o código
// municipal/nacional do XML. Ambos permanecem rastreáveis no lançamento.
const nfse = xml.lerNfseMunicipal(`
  <InfNfse>
    <Numero>26000</Numero>
    <DataEmissao>2026-02-10</DataEmissao>
    <PrestadorServico><Cnpj>05917486000906</Cnpj><RazaoSocial>Fornecedor</RazaoSocial></PrestadorServico>
    <TomadorServico><Cnpj>00000000000100</Cnpj><RazaoSocial>Cliente</RazaoSocial></TomadorServico>
    <Servico>
      <Discriminacao>Serviço de teste</Discriminacao>
      <ItemListaServico>1.05</ItemListaServico>
      <CodigoTributacaoMunicipio>010501</CodigoTributacaoMunicipio>
      <Valores><ValorServicos>100</ValorServicos><ValorIss>2</ValorIss></Valores>
    </Servico>
  </InfNfse>`);
assert.equal(nfse.itens[0].lc116, '0105');
assert.equal(nfse.itens[0].cst, '010501');

const empresa = db.prepare(`INSERT INTO empresas (razao_social, cnpj, regime) VALUES ('Empresa de teste', '00000000000100', 'lucro_presumido')`).run();
const empresaId = Number(empresa.lastInsertRowid);
db.prepare(`INSERT INTO base_servicos (lc116, nbs, descricao_item, cclasstrib, reducao)
  VALUES ('0105', '1140100', 'Licenciamento de software', '000001', 'integral')`).run();
const movimento = db.prepare(`INSERT INTO movimentos
  (empresa_id, tipo, sentido, origem, descricao, ncm, nbs, lc116, cst, competencia, valor, base_calculo, iss)
  VALUES (?, 'fornecedor', 'entrada', 'xml', 'Licenciamento de software', '', '', '0105', '010501', '2026-02', 100, 100, 2)`).run(empresaId);

const resultado = bases.classificarMovimento(empresaId, Number(movimento.lastInsertRowid));
const pendencia = normalizacao.validarMovimento(Number(movimento.lastInsertRowid));
const salvo = db.prepare('SELECT lc116, cst, cclasstrib, classificacao_origem FROM movimentos WHERE id=?').get(movimento.lastInsertRowid);
assert.equal(resultado.status, 'CLASSIFICADO');
assert.equal(salvo.lc116, '0105');
assert.equal(salvo.cst, '010501', 'o código bruto do XML não pode ser sobrescrito');
assert.equal(salvo.cclasstrib, '000001');
assert.match(salvo.classificacao_origem, /^revisao:nbs:/);
assert.deepEqual(pendencia, {
  status: 'PENDENTE', pendencia: 'LC116_IDENTIFICADO_SEM_NBS',
  evidencia: 'Item LC116: 0105 · Código fiscal bruto do XML: 010501',
});

const completa = normalizacao.avaliar({ origem: 'xml', ncm: '', iss: 2, lc116: '1.05', nbs: '1140100', cst: '010501' });
assert.equal(completa.status, 'VALIDADO');
assert.equal(completa.pendencia, '');

// Em XMLs cujo item não vem em tag separada, os quatro primeiros dígitos do
// código fiscal preservado são a evidência do item LC116.
const apenasCodigoFiscal = normalizacao.avaliar({ origem: 'xml', ncm: '', iss: 0, lc116: '', nbs: '115013000', cst: '010701' });
assert.equal(normalizacao.lc116DoDocumento({ lc116: '', cst: '010701' }), '0107');
assert.equal(apenasCodigoFiscal.status, 'VALIDADO');
assert.equal(motorExec.normalizar({
  documento: 'x', origem: 'xml', ncm: '', nbs: '115013000', lc116: '', cst: '010701',
}).lc116, '0107', 'o motor deve consumir o item LC116 já presente no código fiscal do XML');

// Sem chave composta exata, LC116 e NBS precisam continuar disponíveis como
// evidências complementares. A regra genérica da LC116 não pode apagar uma
// exceção específica que o NBS aponta; a decisão final permanece condicionada
// ao resolvedor de elegibilidade.
db.prepare(`INSERT INTO base_servicos (lc116, nbs, descricao_item, cclasstrib, reducao)
  VALUES ('0107', '115013000', 'Suporte técnico', '000001', 'integral'),
         ('0107', '115021000', 'Suporte técnico', '000001', 'integral'),
         ('0106', '115012000', 'Outro serviço', '200043', 'reduzida'),
         ('0106', '115012000', 'Outro serviço', '200044', 'reducao_60')`).run();
const preferenciaLc116 = bases.consultarServico('0107', '115012000');
assert.equal(preferenciaLc116.nivel, 'lc116+nbs');
assert.equal(preferenciaLc116.candidatos.some((x) => x.cclasstrib === '200044'), true);
const classificadoPorQsa = classificar({ nbs: '115012000', lc116: '0107', cst: '010701', iss: 1 }, {
  sentido: 'saida',
  elegibilidadeAnexoXi: {
    adquirente: { status: 'NAO', motivo: 'Cliente privado.' },
    qsa: { status: 'SIM', motivo: 'Sócio brasileiro com participação suficiente.' },
  },
});
assert.equal(classificadoPorQsa.cclasstrib, '200044');
assert.equal(classificadoPorQsa.status, 'CLASSIFICADO');
assert.equal(classificadoPorQsa.reducao, 'reducao_60');
const classificadoComPublicoPendente = classificar({ nbs: '115012000', lc116: '0107', cst: '010701', iss: 1 }, {
  sentido: 'saida',
  elegibilidadeAnexoXi: {
    adquirente: { status: 'PENDENTE', motivo: 'Natureza jurídica não localizada.' },
    qsa: { status: 'SIM', motivo: 'Sócio brasileiro com participação suficiente.' },
  },
});
assert.equal(classificadoComPublicoPendente.cclasstrib, '200044', '200043 pendente não pode bloquear 200044 comprovado pelo QSA');
assert.equal(classificadoComPublicoPendente.status, 'CLASSIFICADO');

console.log('lancamento-classificacao-lc116: item LC116 separado, editável e classificável: OK');
try { db.close?.(); } catch (_) { /* noop */ }
fs.rmSync(dir, { recursive: true, force: true });

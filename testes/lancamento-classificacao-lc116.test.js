const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-lc116-lancamento-'));
process.env.SATTVA_DADOS = dir;

const xml = require('../src/services/importadorXml');
const db = require('../src/db');
const bases = require('../src/services/basesReforma');

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
const salvo = db.prepare('SELECT lc116, cst, cclasstrib, classificacao_origem FROM movimentos WHERE id=?').get(movimento.lastInsertRowid);
assert.equal(resultado.status, 'CLASSIFICADO');
assert.equal(salvo.lc116, '0105');
assert.equal(salvo.cst, '010501', 'o código bruto do XML não pode ser sobrescrito');
assert.equal(salvo.cclasstrib, '000001');
assert.match(salvo.classificacao_origem, /^revisao:nbs:/);

console.log('lancamento-classificacao-lc116: item LC116 separado, editável e classificável: OK');
try { db.close?.(); } catch (_) { /* noop */ }
fs.rmSync(dir, { recursive: true, force: true });

const assert = require('assert');
const { CffErro, criarAgenteCertificado, consultarCff, prepararConsultaAceita, decidirIdempotencia, prepararArquivoOficial } = require('../src/services/cffCatalogo');
const fs = require('fs');
const os = require('os');
const path = require('path');

const filho = { CodClassTrib: '000001', Cst: '000', NomeClassTrib: 'Integral', PercRedIbs: 0, PercRedCbs: 0, DthPublicacao: '2026-06-22T00:00:00', DthIniVig: '2026-01-01T00:00:00', IndTribRegular: true, IndPermiteCredPres: false, IndMonoVal: false, IndMonoRetem: false, IndMonoRet: false, IndMonoDif: false, IndEstornoCred: false, TipoAliq: 2, TipoRbSn: 1, CampoFuturo: 'preservado' };
const pai = { Cst: '000', NomeCst: 'Tributação integral', IndExigeTrib: true, IndMonofasica: false, IndReducaoAliq: false, IndDiferimento: false, IndReducaoBc: false, IndTransferenciaCred: false, IndCredPresIbsZfm: false, IndAjusteCompet: false, ClassificacoesTributarias: [filho] };
const payload = [pai];
function erro(fn, codigo) { assert.throws(fn, (e) => e instanceof CffErro && e.codigo === codigo); }

const consulta = prepararConsultaAceita(payload);
assert.equal(consulta.publicacao, '2026-06-22');
assert(consulta.camposNovos.includes('cClassTrib.CampoFuturo'));
assert.equal(decidirIdempotencia([{ versao: '2026-06-22', arquivo_hash_sha256: consulta.hash_sha256 }], consulta).acao, 'IGNORAR_IDEMPOTENTE');
assert.equal(decidirIdempotencia([{ versao: '2026-06-22', arquivo_hash_sha256: 'a'.repeat(64) }], consulta).acao, 'REQUER_VALIDACAO');
assert.equal(decidirIdempotencia([], consulta).acao, 'CRIAR_RASCUNHO');

erro(() => prepararConsultaAceita([{ ...pai, ClassificacoesTributarias: [{ ...filho, CodClassTrib: 'x' }] }]), 'CFF_CCLASSTRIB_INVALIDO');
erro(() => prepararConsultaAceita([{ ...pai, ClassificacoesTributarias: [{ ...filho, Cst: '200' }] }]), 'CFF_RELACAO_INVALIDA');
const semObrigatorio = { ...filho }; delete semObrigatorio.PercRedCbs;
erro(() => prepararConsultaAceita([{ ...pai, ClassificacoesTributarias: [semObrigatorio] }]), 'CFF_SCHEMA_OBRIGATORIO_AUSENTE');
erro(() => criarAgenteCertificado({}), 'CFF_CERT_CONFIG_MISSING');

function mock(status, body = JSON.stringify(payload)) { return (url, opts, cb) => { const events = {}; const req = { on: (n, f) => { events[n] = f; return req; }, end: () => { const res = { statusCode: status, on: (n, f) => { if (n === 'data') f(Buffer.from(body)); if (n === 'end') f(); } }; cb(res); }, destroy: (e) => events.error(e) }; return req; }; }
function mockErro(codigo) { return () => { const events = {}; const req = { on: (n, f) => { events[n] = f; return req; }, end: () => events.error(Object.assign(new Error(codigo), { code: codigo })), destroy: (e) => events.error(e) }; return req; }; }
(async () => {
  const env = { CFF_CERT_PFX_BASE64: Buffer.from('teste').toString('base64'), CFF_BASE_URL: 'https://exemplo.test/classTrib' };
  assert.deepEqual(await consultarCff({ env, request: mock(200), sleep: async () => {}, tentativas: 1 }), payload);
  for (const status of [401, 403, 429, 500]) await assert.rejects(() => consultarCff({ env, request: mock(status), sleep: async () => {}, tentativas: 1 }), CffErro);
  await assert.rejects(() => consultarCff({ env, request: mock(200, 'nao-json'), sleep: async () => {}, tentativas: 1 }), (e) => e.codigo === 'CFF_JSON_INVALIDO');
  await assert.rejects(() => consultarCff({ env, request: mockErro('ERR_OSSL_PEM_NO_START_LINE'), sleep: async () => {}, tentativas: 1 }), (e) => e.codigo === 'CFF_CERT_INVALIDO');
  await assert.rejects(() => consultarCff({ env, request: mockErro('ETIMEDOUT'), sleep: async () => {}, tentativas: 1 }), (e) => e.codigo === 'CFF_TIMEOUT');
  const arquivo = path.join(os.tmpdir(), 'cff-catalogo-fixture.json'); fs.writeFileSync(arquivo, JSON.stringify(payload));
  assert.equal(prepararArquivoOficial({ arquivo, origemOficial: true }).publicacao, '2026-06-22'); fs.unlinkSync(arquivo);
  console.log('cff-catalogo.test: autenticação, HTTP, schema, drift, hash, idempotência e relações validados.');
})().catch((e) => { console.error(e.stack || e); process.exit(1); });

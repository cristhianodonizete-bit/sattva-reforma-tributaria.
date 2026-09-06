const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-casa-dados-'));
process.env.SATTVA_DADOS = dir;
process.env.CASA_DOS_DADOS_API_KEY = 'chave-casa-exclusiva';
process.env.CNPJ_API_TOKEN = 'token-de-outro-provedor';

const chamadas = [];
const fetchOriginal = global.fetch;
global.fetch = async (url, opcoes = {}) => {
  chamadas.push({ url: String(url), headers: opcoes.headers || {} });
  return {
    ok: true,
    status: 200,
    json: async () => ({ razao_social: 'Empresa de teste', codigo_natureza_juridica: '2062', natureza_juridica: 'Sociedade Empresária Limitada', qsa: [{ nome: 'Sócio', pais: { descricao: 'Brasil' }, percentual_participacao: '20,00%' }] }),
  };
};

const { consultar, enriquecerQsaEmpresa, enriquecerParceiros } = require('../src/services/cnpjReceita');
const banco = require('../src/db');
(async () => {
  const resultado = await consultar('12345678000195', { forcar: true, finalidade: 'qsa' });
  assert.equal(chamadas.length, 1, 'QSA deve consultar primeiro a Casa dos Dados quando a chave existir');
  assert.match(chamadas[0].url, /api\.casadosdados\.com\.br/);
  assert.equal(chamadas[0].headers['api-key'], 'chave-casa-exclusiva');
  assert.notEqual(chamadas[0].headers['api-key'], process.env.CNPJ_API_TOKEN);
  assert.equal(resultado.fonte, 'Casa dos Dados');
  chamadas.length = 0;
  global.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), headers: opcoes.headers || {} });
    const eCasa = /api\.casadosdados\.com\.br/.test(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => eCasa
        ? { razao_social: 'Empresa sem QSA na fonte prioritária', qsa: [] }
        : { razao_social: 'Empresa com QSA no fallback', qsa: [{ nome_socio: 'Sócio do fallback', pais: 'Brasil' }] },
    };
  };
  const fallbackQsa = await consultar('12345678000195', { forcar: true, finalidade: 'qsa' });
  assert.equal(fallbackQsa.fonte, 'BrasilAPI', 'QSA vazio na Casa deve acionar fonte alternativa');
  assert.equal(fallbackQsa.qsa.length, 1);
  assert.equal(chamadas.length, 2, 'a busca deve consultar alternativa quando a fonte prioritária vier sem QSA');
  global.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), headers: opcoes.headers || {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({ razao_social: 'Empresa de teste', codigo_natureza_juridica: '2062', natureza_juridica: 'Sociedade Empresária Limitada', qsa: [{ nome: 'Sócio', pais: { descricao: 'Brasil' }, percentual_participacao: '20,00%' }] }),
    };
  };
  const empresa = banco.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('12345678000195','Empresa de teste','lucro_presumido')").run();
  const qsa = await enriquecerQsaEmpresa(Number(empresa.lastInsertRowid), { forcar: true });
  assert.equal(qsa.socios_recuperados, 1);
  const socio = banco.prepare('SELECT pais, percentual_participacao FROM empresa_qsa WHERE empresa_id=?').get(Number(empresa.lastInsertRowid));
  assert.equal(socio.pais, '');
  assert.equal(socio.percentual_participacao, 20);
  // Uma confirmação humana é a fonte prioritária. Nova consulta automática
  // sem percentual não pode apagar nem alterar os campos validados.
  banco.prepare("UPDATE empresa_qsa SET percentual_participacao=35, brasileiro=1, fonte='confirmação manual', origem='confirmacao_manual' WHERE empresa_id=?")
    .run(Number(empresa.lastInsertRowid));
  await enriquecerQsaEmpresa(Number(empresa.lastInsertRowid), { forcar: true });
  const confirmado = banco.prepare('SELECT percentual_participacao,brasileiro,origem FROM empresa_qsa WHERE empresa_id=?').get(Number(empresa.lastInsertRowid));
  assert.deepEqual([confirmado.percentual_participacao, confirmado.brasileiro, confirmado.origem], [35, 1, 'confirmacao_manual']);
  banco.prepare("INSERT INTO parceiros (empresa_id,tipo,cnpj,descricao,regime) VALUES (?,?,?,?,?)")
    .run(Number(empresa.lastInsertRowid), 'cliente', '98765432000198', 'Cliente com regime informado', 'lucro_real');
  const enriquecimento = await enriquecerParceiros(Number(empresa.lastInsertRowid));
  assert.equal(enriquecimento.total, 1, 'Natureza jurídica ausente deve entrar na consulta mesmo com regime informado');
  const natureza = banco.prepare('SELECT codigo_natureza_juridica FROM cnpj_cache WHERE cnpj=?').get('98765432000198');
  assert.equal(natureza.codigo_natureza_juridica, '2062');
  // CNAE não utiliza a InfoSimples: BrasilAPI é a fonte primária gratuita.
  process.env.INFOSIMPLES_API_KEY = 'token-invalido-para-teste'; chamadas.length = 0;
  global.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url:String(url), headers:opcoes.headers || {} });
    return { ok:true, status:200, json:async()=>({ razao_social:'Empresa com CNAE', cnae_fiscal:6201501, cnae_fiscal_descricao:'Desenvolvimento de programas sob encomenda', cnaes_secundarios:[{ codigo:6202300, descricao:'Programas customizáveis' }] }) };
  };
  const cnaeFallback = await consultar('11222333000181', { forcar:true, finalidade:'cnae_carteira' });
  assert.equal(cnaeFallback.cnae, '6201501');
  assert.equal(cnaeFallback.cnaes_secundarios.length, 1);
  assert.equal(chamadas.some(({ url }) => /infosimples/.test(url)), false);
  assert.equal(chamadas.some(({ url }) => /brasilapi/.test(url)), true);
  assert.equal(chamadas.find(({ url }) => /brasilapi/.test(url)).headers['User-Agent'], 'Sattva-Reforma-Tributaria/1.0');
  // ReceitaWS é acionada somente se a BrasilAPI não responder.
  chamadas.length = 0;
  global.fetch = async (url) => {
    chamadas.push({ url:String(url), headers:{} });
    if (/brasilapi/.test(String(url))) return { ok:false, status:503, json:async()=>({}) };
    return { ok:true, status:200, json:async()=>({
      nome:'Empresa ReceitaWS', atividade_principal:[{ code:'5611201', text:'Restaurantes e similares' }],
      atividades_secundarias:[{ code:'4721103', text:'Comércio varejista de laticínios e frios' }],
    }) };
  };
  const cnaeReceitaWs = await consultar('22333444000192', { forcar:true, finalidade:'cnae_carteira' });
  assert.equal(cnaeReceitaWs.cnae, '5611201');
  assert.equal(cnaeReceitaWs.cnae_descricao, 'Restaurantes e similares');
  assert.deepEqual(cnaeReceitaWs.cnaes_secundarios, [{ codigo:'4721103', descricao:'Comércio varejista de laticínios e frios' }]);
  assert.equal(chamadas.length, 2, 'ReceitaWS só deve ser chamada após falha da BrasilAPI');
  assert.equal(chamadas.some(({ url }) => /infosimples/.test(url)), false);
  console.log('cnpj-receita-casa-dados: credencial e prioridade QSA: OK');
})().finally(() => {
  global.fetch = fetchOriginal;
  try { banco.close?.(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
}).catch((erro) => { console.error(erro); process.exitCode = 1; });

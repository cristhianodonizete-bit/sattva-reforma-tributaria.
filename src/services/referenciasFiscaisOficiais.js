/**
 * Referências fiscais oficiais
 *
 * Camada de identificação, fora do motor. Não importa nem promove regras
 * fiscais: preserva a fonte e permite completar NCM/NBS/LC116 sem alterar a
 * base operacional já homologada.
 */
const db = require('../db');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');

const somenteDigitos = (valor) => String(valor == null ? '' : valor).replace(/\D/g, '');
const normalizarNcm = (valor) => somenteDigitos(valor).padStart(8, '0').slice(-8);
const normalizarNbs = (valor) => somenteDigitos(valor).padStart(9, '0').slice(-9);
const normalizarLc116 = (valor) => somenteDigitos(valor).padStart(4, '0').slice(-4);

function normalizarCodigo(dominio, codigo) {
  if (dominio === 'NCM') return normalizarNcm(codigo);
  if (dominio === 'NBS') return normalizarNbs(codigo);
  if (dominio === 'LC116') return normalizarLc116(codigo);
  throw new Error(`Domínio oficial inválido: ${dominio}`);
}

function validarReferencia(referencia) {
  const dominio = String(referencia?.dominio || '').toUpperCase();
  const codigo = normalizarCodigo(dominio, referencia?.codigo);
  if (!codigo || /^0+$/.test(codigo)) throw new Error(`Código ${dominio} inválido`);
  const fonte = String(referencia?.fonte || '').trim();
  if (!fonte) throw new Error('Fonte oficial é obrigatória');
  return {
    dominio, codigo,
    descricao: String(referencia?.descricao || '').trim(),
    vigencia_inicio: String(referencia?.vigencia_inicio || '').trim(),
    vigencia_fim: referencia?.vigencia_fim ? String(referencia.vigencia_fim).trim() : null,
    situacao: String(referencia?.situacao || 'VIGENTE').toUpperCase(),
    fonte, versao_fonte: String(referencia?.versao_fonte || '').trim(),
    hash_origem: String(referencia?.hash_origem || '').trim(),
    dados_origem: JSON.stringify(referencia?.dados_origem || {}),
  };
}

function registrarReferencia(referencia) {
  const r = validarReferencia(referencia);
  const existente = db.prepare(`SELECT id FROM referencias_fiscais_oficiais
    WHERE dominio=? AND codigo=? AND vigencia_inicio=? AND fonte=? AND versao_fonte=?`).get(
    r.dominio, r.codigo, r.vigencia_inicio, r.fonte, r.versao_fonte);
  if (existente) return { id: existente.id, criado: false, ...r };
  const out = db.prepare(`INSERT INTO referencias_fiscais_oficiais
    (dominio,codigo,descricao,vigencia_inicio,vigencia_fim,situacao,fonte,versao_fonte,hash_origem,dados_origem)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    r.dominio, r.codigo, r.descricao, r.vigencia_inicio, r.vigencia_fim, r.situacao,
    r.fonte, r.versao_fonte, r.hash_origem, r.dados_origem);
  return { id: Number(out.lastInsertRowid), criado: true, ...r };
}

function registrarRelacaoNbsLc116(relacao) {
  const localizarOuRegistrar = (referencia, dominio) => {
    const codigo = normalizarCodigo(dominio, referencia.codigo);
    const existente = db.prepare(`SELECT id, dominio, codigo FROM referencias_fiscais_oficiais
      WHERE dominio=? AND codigo=? AND situacao='VIGENTE' ORDER BY id LIMIT 1`).get(dominio, codigo);
    return existente || registrarReferencia({ ...referencia, dominio });
  };
  const nbs = localizarOuRegistrar(relacao.nbs, 'NBS');
  const lc116 = localizarOuRegistrar(relacao.lc116, 'LC116');
  const vigenciaInicio = String(relacao.vigencia_inicio || '').trim();
  const fonte = String(relacao.fonte || '').trim();
  if (!fonte) throw new Error('Fonte oficial da relação NBS/LC116 é obrigatória');
  const existente = db.prepare(`SELECT id FROM referencias_fiscais_relacoes
    WHERE origem_id=? AND destino_id=? AND tipo='NBS_LC116' AND vigencia_inicio=? AND fonte=?`).get(nbs.id, lc116.id, vigenciaInicio, fonte);
  if (existente) return { id: existente.id, criado: false, nbs, lc116 };
  const out = db.prepare(`INSERT INTO referencias_fiscais_relacoes
    (origem_id,destino_id,tipo,vigencia_inicio,vigencia_fim,fonte,evidencia) VALUES (?,?, 'NBS_LC116',?,?,?,?)`).run(
    nbs.id, lc116.id, vigenciaInicio, relacao.vigencia_fim || null, fonte, relacao.evidencia || null);
  return { id: Number(out.lastInsertRowid), criado: true, nbs, lc116 };
}

/**
 * Lê o Anexo VIII do padrão nacional da NFS-e. Cada relação importada exige
 * que os dois códigos já existam na referência oficial. IndOp e cClassTrib
 * são deliberadamente ignorados aqui: esta função só cria NBS–LC116.
 */
function relacoesNbsLc116DoAnexoViii(arquivo) {
  const bruto = fs.readFileSync(arquivo);
  const planilha = XLSX.read(bruto, { type: 'buffer', raw: false });
  const nome = planilha.SheetNames.find((x) => /tabela geral/i.test(x));
  if (!nome) throw new Error('Anexo VIII não possui a aba "tabela geral" esperada');
  const linhas = XLSX.utils.sheet_to_json(planilha.Sheets[nome], { defval: '', raw: false });
  const encontrados = [];
  let lc116Atual = null;
  for (const linha of linhas) {
    const lc116DaLinha = String(linha['Item LC 116'] || '').trim();
    if (/^\d{1,2}\.\d{2}$/.test(lc116DaLinha)) lc116Atual = lc116DaLinha;
    const nbs = String(linha.NBS || '').trim();
    if (!lc116Atual || somenteDigitos(nbs).length !== 9) continue;
    encontrados.push({ nbs, lc116: lc116Atual });
  }
  const unicos = new Map(encontrados.map((x) => [`${normalizarNbs(x.nbs)}:${normalizarLc116(x.lc116)}`, x]));
  if (!unicos.size) throw new Error('Anexo VIII não contém pares NBS–LC116 explícitos');
  return { relacoes: [...unicos.values()], hash: sha256(bruto), linhas_lidas: linhas.length };
}

function importarRelacoesNbsLc116DoAnexoViii({ arquivo, aplicar = false } = {}) {
  const dados = relacoesNbsLc116DoAnexoViii(arquivo);
  const resumo = { relacoes_lidas: dados.relacoes.length, hash: dados.hash, aplicado: Boolean(aplicar) };
  if (!aplicar) return resumo;
  let inseridas = 0;
  let semReferencia = 0;
  db.transaction(() => {
    for (const par of dados.relacoes) {
      const nbs = db.prepare(`SELECT id FROM referencias_fiscais_oficiais
        WHERE dominio='NBS' AND codigo=? AND situacao='VIGENTE' ORDER BY id LIMIT 1`).get(normalizarNbs(par.nbs));
      const lc116 = db.prepare(`SELECT id FROM referencias_fiscais_oficiais
        WHERE dominio='LC116' AND codigo=? AND situacao='VIGENTE' ORDER BY id LIMIT 1`).get(normalizarLc116(par.lc116));
      if (!nbs || !lc116) { semReferencia += 1; continue; }
      inseridas += db.prepare(`INSERT OR IGNORE INTO referencias_fiscais_relacoes
        (origem_id,destino_id,tipo,vigencia_inicio,fonte,evidencia) VALUES (?,?,'NBS_LC116',?,?,?)`).run(
        nbs.id, lc116.id, '2026-01-01', 'Anexo VIII SNNFSe — correlação Item NBS, IndOp e cClassTrib IBS/CBS',
        `Arquivo hash ${dados.hash}`).changes;
    }
  })();
  return { ...resumo, inseridas, existentes: dados.relacoes.length - inseridas - semReferencia, sem_referencia: semReferencia };
}

function consultar({ ncm, nbs, lc116, somenteVigentes = true } = {}) {
  const filtros = [], params = [];
  const ativos = somenteVigentes ? " AND situacao='VIGENTE'" : '';
  if (ncm) { filtros.push("(dominio='NCM' AND codigo=?)"); params.push(normalizarNcm(ncm)); }
  if (nbs) { filtros.push("(dominio='NBS' AND codigo=?)"); params.push(normalizarNbs(nbs)); }
  if (lc116) { filtros.push("(dominio='LC116' AND codigo=?)"); params.push(normalizarLc116(lc116)); }
  if (!filtros.length) return [];
  return db.prepare(`SELECT * FROM referencias_fiscais_oficiais WHERE (${filtros.join(' OR ')})${ativos} ORDER BY dominio,codigo,vigencia_inicio DESC`).all(...params);
}

// Esta consulta é exclusivamente para a tela de referência. Ela não mistura a
// nomenclatura oficial com a matriz operacional nem é utilizada pelo motor.
function listar({ dominio, busca = '', pagina = 1, tamanho = 50, somenteVigentes = true } = {}) {
  const dominioNormalizado = String(dominio || '').toUpperCase();
  if (!['NCM', 'NBS', 'LC116'].includes(dominioNormalizado)) throw new Error('Domínio oficial inválido');
  const termo = String(busca || '').trim();
  const digitos = somenteDigitos(termo);
  const filtros = ['dominio=?'];
  const parametros = [dominioNormalizado];
  if (somenteVigentes) filtros.push("situacao='VIGENTE'");
  if (termo) {
    filtros.push('(codigo LIKE ? OR descricao LIKE ?)');
    // A busca por código é deliberadamente parcial: a tela deve aceitar o
    // formato que o usuário enxerga na fonte, sem transformar a chave gravada.
    parametros.push(`%${digitos || termo}%`, `%${termo}%`);
  }
  const onde = filtros.join(' AND ');
  const paginaSegura = Math.max(1, Number(pagina) || 1);
  const tamanhoSeguro = Math.min(100, Math.max(10, Number(tamanho) || 50));
  const total = db.prepare(`SELECT COUNT(*) c FROM referencias_fiscais_oficiais WHERE ${onde}`).get(...parametros).c;
  const itens = db.prepare(`SELECT id,dominio,codigo,descricao,vigencia_inicio,vigencia_fim,situacao,fonte,versao_fonte,hash_origem
    FROM referencias_fiscais_oficiais WHERE ${onde} ORDER BY codigo, vigencia_inicio DESC LIMIT ? OFFSET ?`)
    .all(...parametros, tamanhoSeguro, (paginaSegura - 1) * tamanhoSeguro);
  return { dominio: dominioNormalizado, pagina: paginaSegura, tamanho: tamanhoSeguro, total, itens };
}

function resumo() {
  const linhas = db.prepare(`SELECT dominio, situacao, COUNT(*) quantidade
    FROM referencias_fiscais_oficiais GROUP BY dominio, situacao`).all();
  const resultado = { NCM: { total: 0, vigentes: 0 }, NBS: { total: 0, vigentes: 0 }, LC116: { total: 0, vigentes: 0 } };
  for (const linha of linhas) {
    if (!resultado[linha.dominio]) continue;
    resultado[linha.dominio].total += Number(linha.quantidade) || 0;
    if (linha.situacao === 'VIGENTE') resultado[linha.dominio].vigentes += Number(linha.quantidade) || 0;
  }
  return resultado;
}

function sha256(conteudo) { return crypto.createHash('sha256').update(conteudo).digest('hex'); }

function referenciasNcmDoBuffer(bruto) {
  const json = JSON.parse(bruto.toString('utf8'));
  const data = String(json.Data_Ultima_Atualizacao_NCM || '').trim();
  const versao = [data, json.Ato].filter(Boolean).join(' | ');
  const linhas = (json.Nomenclaturas || []).filter((x) => somenteDigitos(x.Codigo).length === 8).map((x) => ({
    dominio: 'NCM', codigo: x.Codigo, descricao: x.Descricao || '',
    vigencia_inicio: x.Data_Inicio || '',
    vigencia_fim: x.Data_Fim && x.Data_Fim !== '31/12/9999' ? x.Data_Fim : null,
    situacao: x.Data_Fim === '31/12/9999' ? 'VIGENTE' : 'HISTORICO',
    fonte: 'Receita Federal / Siscomex Classif', versao_fonte: versao,
    hash_origem: sha256(bruto), dados_origem: x,
  }));
  return { linhas, versao, hash: sha256(bruto), atualizacao: data };
}

function referenciasNcmDoArquivo(arquivo) {
  return referenciasNcmDoBuffer(fs.readFileSync(arquivo));
}

function referenciasNbsDoBuffer(bruto) {
  // O CSV oficial NBS 2.0 é publicado em codificação Windows-1252 e usa
  // ponto e vírgula. Mantemos a descrição como recebida, sem normalização
  // semântica ou associação a LC116.
  const texto = new TextDecoder('windows-1252').decode(bruto);
  const [cabecalho, ...corpo] = texto.split(/\r?\n/).filter(Boolean);
  if (!/NBS/i.test(cabecalho)) throw new Error('Arquivo NBS não possui cabeçalho oficial esperado');
  const linhas = corpo.map((linha) => {
    const sep = linha.indexOf(';');
    return { codigo: sep < 0 ? linha : linha.slice(0, sep), descricao: sep < 0 ? '' : linha.slice(sep + 1) };
  }).filter((x) => somenteDigitos(x.codigo).length === 9).map((x) => ({
    dominio: 'NBS', codigo: x.codigo, descricao: x.descricao,
    vigencia_inicio: '2019-01-01', situacao: 'VIGENTE',
    fonte: 'MDIC / NBS 2.0', versao_fonte: 'NBS 2.0 | arquivo publicado em 03/07/2025',
    hash_origem: sha256(bruto), dados_origem: { codigo_publicado: x.codigo },
  }));
  return { linhas, hash: sha256(bruto) };
}

function referenciasNbsDoArquivo(arquivo) {
  return referenciasNbsDoBuffer(fs.readFileSync(arquivo));
}

const URL_NCM_OFICIAL = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json';
const URL_NBS_OFICIAL = 'https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/arquivos/nbs2-0.csv/@@download/file/NBS_2-0.csv';

async function baixarArquivoOficial(url, rotulo, { fetcher = fetch } = {}) {
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), 30000);
  try {
    const resposta = await fetcher(url, { signal: controlador.signal, headers: { Accept: 'application/json,text/csv,*/*' } });
    if (!resposta.ok) throw new Error(`${rotulo}: fonte oficial respondeu HTTP ${resposta.status}.`);
    const bruto = Buffer.from(await resposta.arrayBuffer());
    if (!bruto.length) throw new Error(`${rotulo}: fonte oficial retornou arquivo vazio.`);
    return bruto;
  } catch (erro) {
    if (erro.name === 'AbortError') throw new Error(`${rotulo}: consulta à fonte oficial excedeu 30 segundos.`);
    throw erro;
  } finally { clearTimeout(limite); }
}

// A referência de chaves é atualizada da fonte pública oficial. Ela não traz
// tratamento tributário nem altera regras específicas já publicadas.
async function baixarReferenciasOficiaisVigentes({ fetcher = fetch } = {}) {
  const [brutoNcm, brutoNbs] = await Promise.all([
    baixarArquivoOficial(URL_NCM_OFICIAL, 'NCM/Siscomex', { fetcher }),
    baixarArquivoOficial(URL_NBS_OFICIAL, 'NBS/MDIC', { fetcher }),
  ]);
  return { ncm: referenciasNcmDoBuffer(brutoNcm), nbs: referenciasNbsDoBuffer(brutoNbs) };
}

function inserirReferencias(linhas, banco) {
  const inserir = banco.prepare(`INSERT OR IGNORE INTO referencias_fiscais_oficiais
    (dominio,codigo,descricao,vigencia_inicio,vigencia_fim,situacao,fonte,versao_fonte,hash_origem,dados_origem)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  let inseridos = 0;
  banco.transaction(() => {
    for (const x of linhas) {
      const r = validarReferencia(x);
      inseridos += inserir.run(r.dominio, r.codigo, r.descricao, r.vigencia_inicio, r.vigencia_fim, r.situacao,
        r.fonte, r.versao_fonte, r.hash_origem, r.dados_origem).changes;
    }
  })();
  return inseridos;
}

async function sincronizarReferenciasOficiaisVigentes({ banco = db, fetcher = fetch } = {}) {
  const dados = await baixarReferenciasOficiaisVigentes({ fetcher });
  const linhas = [...dados.ncm.linhas, ...dados.nbs.linhas];
  const inseridos = inserirReferencias(linhas, banco);
  return {
    ncm_lidos: dados.ncm.linhas.length,
    nbs_lidos: dados.nbs.linhas.length,
    ncm_hash: dados.ncm.hash,
    nbs_hash: dados.nbs.hash,
    inseridos,
    existentes: linhas.length - inseridos,
    fonte_ncm: URL_NCM_OFICIAL,
    fonte_nbs: URL_NBS_OFICIAL,
  };
}

function referenciasLc116DoArquivo(arquivo) {
  const bruto = fs.readFileSync(arquivo);
  const texto = new TextDecoder('utf-8').decode(bruto);
  const linhasBrutas = texto.split(/\r?\n/).filter((x) => x.trim());
  const linhas = linhasBrutas.map((linha) => {
    const sep = linha.indexOf(';');
    return { codigo: sep < 0 ? linha : linha.slice(0, sep), descricao: sep < 0 ? '' : linha.slice(sep + 1) };
  }).filter((x) => /^\d{1,2}\.\d{2}$/.test(String(x.codigo).trim())).map((x) => ({
    dominio: 'LC116', codigo: x.codigo, descricao: x.descricao.trim(),
    vigencia_inicio: '2003-08-01', situacao: 'VIGENTE',
    fonte: 'Lei Complementar 116/2003 — lista oficial de serviços',
    versao_fonte: 'texto consolidado identificado pelo arquivo de origem',
    hash_origem: sha256(bruto), dados_origem: { codigo_publicado: x.codigo },
  }));
  if (!linhas.length) throw new Error('Arquivo LC116 não contém itens no formato 1.01;Descrição');
  return { linhas, hash: sha256(bruto) };
}

function decodificarTextoHtml(texto) {
  return String(texto || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#xa0;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, codigo) => String.fromCharCode(Number(codigo)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrai somente os subitens da lista consolidada da LC 116 publicada pelo Senado.
 * Esta referência legal não cria correlação NBS–LC116 nem tratamento fiscal. */
function referenciasLc116DoHtmlOficial(arquivo) {
  const bruto = fs.readFileSync(arquivo);
  const html = new TextDecoder('utf-8').decode(bruto);
  const inicio = html.lastIndexOf('Lista de serviços anexa');
  if (inicio < 0) throw new Error('Texto oficial não contém a lista de serviços da LC 116');
  const paragrafos = [...html.slice(inicio).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((x) => decodificarTextoHtml(x[1]));
  const itens = paragrafos.map((texto) => {
    const encontrado = texto.match(/^(\d{1,2}\.\d{2})\s*[-–]\s*(.+)$/);
    return encontrado && { codigo: encontrado[1], descricao: encontrado[2] };
  }).filter(Boolean);
  if (!itens.length) throw new Error('Texto oficial não contém subitens LC116 no formato 1.01 - Descrição');
  const hash = sha256(bruto);
  return {
    linhas: itens.map((x) => ({
      dominio: 'LC116', codigo: x.codigo, descricao: x.descricao,
      vigencia_inicio: '2003-08-01', situacao: 'VIGENTE',
      fonte: 'Senado Federal — LC 116/2003, texto consolidado',
      versao_fonte: 'publicação 34621012, consultada em 2026-09-07',
      hash_origem: hash, dados_origem: { codigo_publicado: x.codigo },
    })),
    hash,
  };
}

function importarReferenciasOficiais({ arquivoNcm, arquivoNbs, arquivoLc116, arquivoLc116Html, aplicar = false } = {}) {
  const ncm = arquivoNcm ? referenciasNcmDoArquivo(arquivoNcm) : { linhas: [] };
  const nbs = arquivoNbs ? referenciasNbsDoArquivo(arquivoNbs) : { linhas: [] };
  if (arquivoLc116 && arquivoLc116Html) throw new Error('Informe apenas uma fonte LC116 por carga');
  const lc116 = arquivoLc116 ? referenciasLc116DoArquivo(arquivoLc116)
    : arquivoLc116Html ? referenciasLc116DoHtmlOficial(arquivoLc116Html) : { linhas: [] };
  const resumo = { ncm_lidos: ncm.linhas.length, nbs_lidos: nbs.linhas.length, lc116_lidos: lc116.linhas.length, ncm_hash: ncm.hash || null, nbs_hash: nbs.hash || null, lc116_hash: lc116.hash || null, aplicado: Boolean(aplicar) };
  if (!aplicar) return resumo;
  const inserir = db.prepare(`INSERT OR IGNORE INTO referencias_fiscais_oficiais
    (dominio,codigo,descricao,vigencia_inicio,vigencia_fim,situacao,fonte,versao_fonte,hash_origem,dados_origem)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  let inseridos = 0;
  db.transaction(() => {
    for (const x of [...ncm.linhas, ...nbs.linhas, ...lc116.linhas]) {
      const r = validarReferencia(x);
      inseridos += inserir.run(r.dominio, r.codigo, r.descricao, r.vigencia_inicio, r.vigencia_fim, r.situacao,
        r.fonte, r.versao_fonte, r.hash_origem, r.dados_origem).changes;
    }
  })();
  return { ...resumo, inseridos, existentes: ncm.linhas.length + nbs.linhas.length + lc116.linhas.length - inseridos };
}

module.exports = {
  normalizarNcm, normalizarNbs, normalizarLc116, registrarReferencia, registrarRelacaoNbsLc116, consultar, listar, resumo,
  referenciasNcmDoArquivo, referenciasNcmDoBuffer, referenciasNbsDoArquivo, referenciasNbsDoBuffer, referenciasLc116DoArquivo, referenciasLc116DoHtmlOficial, importarReferenciasOficiais,
  baixarReferenciasOficiaisVigentes, sincronizarReferenciasOficiaisVigentes,
  relacoesNbsLc116DoAnexoViii, importarRelacoesNbsLc116DoAnexoViii,
};

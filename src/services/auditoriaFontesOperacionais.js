/*
 * Auditoria de fontes operacionais.
 *
 * Esta rotina e' deliberadamente somente leitura. Ela nao chama a
 * reconciliacao que grava no SQLite, nao executa o motor e nao publica nada.
 * Seu objetivo e' deixar visivel, com a mesma chave de negocio, o que existe
 * na fonte compartilhada, no cache local e na ultima fotografia do motor.
 */
const crypto = require('crypto');
const { Pool } = require('pg');
const db = require('../db');
const motorExec = require('./motorExec');
const receitaOperacional = require('./receitaOperacional');

let pool;
function obterPool() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('Fonte compartilhada indisponivel para a auditoria de fontes.');
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 12_000,
    });
  }
  return pool;
}

const texto = (valor) => String(valor == null ? '' : valor).trim();
const digitos = (valor) => texto(valor).replace(/\D/g, '');
const numero = (valor) => Number(valor || 0);
const dinheiro = (valor) => Math.round(numero(valor) * 100) / 100;
const hash = (valor) => crypto.createHash('sha256').update(JSON.stringify(valor)).digest('hex');
const TABELAS_ADICIONAIS = new Set(['parceiros', 'receitas_sem_dfe', 'perfil_tributario', 'perfil_cbs_competencias']);
const CAMPOS_TECNICOS = new Set(['id', 'empresa_id', 'criado_em', 'atualizado_em', 'origem_local_id']);

// Chave de negocio, nunca id tecnico. NFe/NFSe e' identificada pela chave e
// item. Lancamentos sem chave recebem uma identidade conservadora; se ela
// aparecer mais de uma vez em qualquer camada, o caso vira ambiguo.
function chaveIdentidade(linha = {}) {
  const chave = texto(linha.chave);
  const tipo = texto(linha.tipo).toLowerCase();
  const item = texto(linha.item_numero || '0');
  if (chave) return `FISCAL|${tipo}|${chave}|${item}`;
  return [
    'OPERACIONAL',
    tipo,
    texto(linha.origem).toUpperCase(),
    texto(linha.competencia),
    texto(linha.data_emissao).slice(0, 10),
    digitos(linha.documento) || texto(linha.documento).toUpperCase(),
    item,
    digitos(linha.inscr_federal),
  ].join('|');
}

function conteudoComparavel(linha = {}) {
  return {
    competencia: texto(linha.competencia),
    tipo: texto(linha.tipo).toLowerCase(),
    valor: dinheiro(linha.valor),
    documento: texto(linha.documento),
    data_emissao: texto(linha.data_emissao).slice(0, 10),
    situacao_documento: texto(linha.situacao_documento).toUpperCase(),
    cst: texto(linha.cst),
    cclasstrib: texto(linha.cclasstrib),
    cfop: texto(linha.cfop),
    ncm: texto(linha.ncm),
    nbs: texto(linha.nbs),
    lc116: texto(linha.lc116),
    descricao: texto(linha.descricao).replace(/\s+/g, ' ').toUpperCase(),
  };
}

function indexar(linhas = []) {
  const mapa = new Map();
  for (const linha of linhas) {
    const chave = chaveIdentidade(linha);
    const grupo = mapa.get(chave) || [];
    grupo.push(linha);
    mapa.set(chave, grupo);
  }
  return mapa;
}

function chaveRegistro(tabela, linha = {}) {
  if (tabela === 'parceiros') return [texto(linha.tipo).toLowerCase(), digitos(linha.cnpj) || texto(linha.descricao).toUpperCase()].join('|');
  if (tabela === 'receitas_sem_dfe') return texto(linha.chave_deduplicacao) || [linha.competencia, linha.item_receita_chave || linha.tipo_receita, texto(linha.descricao).toUpperCase(), dinheiro(linha.valor)].join('|');
  if (tabela === 'perfil_tributario' || tabela === 'perfil_cbs_competencias') return texto(linha.competencia);
  throw new Error(`Tabela sem identidade de auditoria: ${tabela}`);
}

function normalizarRegistro(tabela, linha = {}) {
  // Cadastro de fornecedor: somente campos de negócio podem caracterizar uma
  // divergência. Origem, datas e outros metadados internos não podem fazer a
  // tela acusar que dois cadastros iguais são diferentes.
  if (tabela === 'parceiros') {
    return {
      tipo: texto(linha.tipo).toLowerCase(),
      cnpj: digitos(linha.cnpj),
      descricao: texto(linha.descricao).replace(/\s+/g, ' ').toUpperCase(),
      regime: texto(linha.regime).toLowerCase(),
    };
  }
  return Object.keys(linha).sort().reduce((saida, campo) => {
    if (CAMPOS_TECNICOS.has(campo)) return saida;
    const valor = linha[campo];
    if (typeof valor === 'number') saida[campo] = dinheiro(valor);
    else if (valor && typeof valor === 'object') saida[campo] = JSON.stringify(valor);
    else saida[campo] = valor == null ? null : texto(valor);
    return saida;
  }, {});
}

function camposDivergentes(canonico = {}, local = {}) {
  const campos = new Set([...Object.keys(canonico), ...Object.keys(local)]);
  return [...campos].filter((campo) => JSON.stringify(canonico[campo] ?? null) !== JSON.stringify(local[campo] ?? null));
}

function compararRegistros(tabela, canonicos = [], locais = []) {
  const agrupar = (linhas) => {
    const mapa = new Map();
    for (const linha of linhas) {
      const chave = chaveRegistro(tabela, linha);
      const grupo = mapa.get(chave) || [];
      grupo.push(linha); mapa.set(chave, grupo);
    }
    return mapa;
  };
  const remoto = agrupar(canonicos), local = agrupar(locais);
  const divergencias = [];
  for (const chave of new Set([...remoto.keys(), ...local.keys()])) {
    const r = remoto.get(chave) || [], l = local.get(chave) || [];
    const comparavelCanonico = r.length === 1 ? normalizarRegistro(tabela, r[0]) : null;
    const comparavelLocal = l.length === 1 ? normalizarRegistro(tabela, l[0]) : null;
    const camposDiferentes = comparavelCanonico && comparavelLocal
      ? camposDivergentes(comparavelCanonico, comparavelLocal)
      : [];
    const status = r.length > 1 || l.length > 1 ? 'IDENTIDADE_AMBIGUA'
      : !r.length ? 'SO_NO_CACHE_LOCAL'
      : !l.length ? 'SO_NA_FONTE_CANONICA'
      : camposDiferentes.length ? 'DIVERGENCIA_DE_CONTEUDO'
      : 'CONFERE';
    if (status !== 'CONFERE') divergencias.push({ chave_identidade:chave, status, campos_divergentes:camposDiferentes, canonico:r, cache_local:l });
  }
  const resumo = { CONFERE: 0 };
  for (const chave of new Set([...remoto.keys(), ...local.keys()])) {
    const achada = divergencias.find((x) => x.chave_identidade === chave);
    resumo[achada?.status || 'CONFERE'] = (resumo[achada?.status || 'CONFERE'] || 0) + 1;
  }
  return { tabela, total_canonico:canonicos.length, total_cache_local:locais.length, resumo, divergencias };
}

function resumoLinha(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    competencia: linha.competencia || null,
    tipo: linha.tipo || null,
    documento: linha.documento || null,
    chave: linha.chave || null,
    item_numero: linha.item_numero ?? null,
    data_emissao: linha.data_emissao || null,
    parceiro: linha.nome || null,
    cnpj: linha.inscr_federal || null,
    valor: dinheiro(linha.valor),
    origem: linha.origem || null,
    situacao_documento: linha.situacao_documento || null,
    cst: linha.cst || null,
    cclasstrib: linha.cclasstrib || null,
  };
}

function compararCamadas(canonicos = [], locais = [], resultadosMotor = []) {
  const remoto = indexar(canonicos);
  const local = indexar(locais);
  const linhas = [];
  const chaves = new Set([...remoto.keys(), ...local.keys()]);
  for (const chave of chaves) {
    const r = remoto.get(chave) || [];
    const l = local.get(chave) || [];
    // Ausência em uma das camadas é uma divergência objetiva. Ambiguidade só
    // existe quando há mais de um candidato para a mesma identidade.
    const ambigua = r.length > 1 || l.length > 1;
    let status;
    if (ambigua) status = 'IDENTIDADE_AMBIGUA';
    else if (!r.length) status = 'SO_NO_CACHE_LOCAL';
    else if (!l.length) status = 'SO_NA_FONTE_CANONICA';
    else if (JSON.stringify(conteudoComparavel(r[0])) !== JSON.stringify(conteudoComparavel(l[0]))) status = 'DIVERGENCIA_DE_CONTEUDO';
    else status = 'CONFERE';
    linhas.push({
      chave_identidade: chave,
      status,
      canonico: r.map(resumoLinha),
      cache_local: l.map(resumoLinha),
      motor: [],
    });
  }

  for (const resultado of resultadosMotor || []) {
    const movimentoId = Number(resultado.movimento_id);
    if (!Number.isInteger(movimentoId)) continue;
    const localLinha = locais.find((x) => Number(x.id) === movimentoId);
    const existeCanonico = localLinha && [...remoto.values()].flat().some((x) => chaveIdentidade(x) === chaveIdentidade(localLinha));
    if (!existeCanonico) {
      linhas.push({
        chave_identidade: localLinha ? chaveIdentidade(localLinha) : `RESULTADO|${movimentoId}`,
        status: 'RESULTADO_DERIVADO_ORFAO',
        canonico: [],
        cache_local: localLinha ? [resumoLinha(localLinha)] : [],
        motor: [{ movimento_id: movimentoId, execucao_id: resultado.execucao_id || null, valor: dinheiro(resultado.preco_atual) }],
      });
    }
  }
  return linhas.sort((a, b) => a.status.localeCompare(b.status) || a.chave_identidade.localeCompare(b.chave_identidade));
}

function totaisPorCompetencia(canonicos = [], locais = [], resultadosMotor = []) {
  const acumular = (linhas, campoValor) => {
    const mapa = new Map();
    for (const linha of linhas) {
      if (texto(linha.tipo).toLowerCase() !== 'cliente') continue;
      const competencia = texto(linha.competencia) || 'SEM_COMPETENCIA';
      const atual = mapa.get(competencia) || { documentos: 0, valor: 0, documentos_receita: 0, receita: 0, documentos_cancelados: 0, valor_cancelado: 0 };
      atual.documentos += 1;
      atual.valor += numero(linha[campoValor]);
      if (['CANCELADO','DENEGADO','INUTILIZADO'].includes(texto(linha.situacao_documento).toUpperCase())) {
        atual.documentos_cancelados += 1;
        atual.valor_cancelado += numero(linha[campoValor]);
      }
      if (receitaOperacional.compoeReceita(linha)) {
        atual.documentos_receita += 1;
        atual.receita += numero(linha[campoValor]);
      }
      mapa.set(competencia, atual);
    }
    return mapa;
  };
  const remoto = acumular(canonicos, 'valor');
  const local = acumular(locais, 'valor');
  const motor = new Map();
  const localPorId = new Map(locais.map((x) => [Number(x.id), x]));
  for (const resultado of resultadosMotor) {
    const movimento = localPorId.get(Number(resultado.movimento_id));
    if (!movimento || texto(movimento.tipo).toLowerCase() !== 'cliente') continue;
    const competencia = texto(movimento.competencia) || 'SEM_COMPETENCIA';
    const atual = motor.get(competencia) || { documentos: 0, valor: 0, documentos_receita: 0, receita: 0, documentos_cancelados: 0, valor_cancelado: 0 };
    atual.documentos += 1;
    atual.valor += numero(resultado.preco_atual);
    if (receitaOperacional.compoeReceita(movimento)) {
      atual.documentos_receita += 1;
      atual.receita += numero(resultado.preco_atual);
    }
    motor.set(competencia, atual);
  }
  const competencias = new Set([...remoto.keys(), ...local.keys(), ...motor.keys()]);
  return [...competencias].sort().map((competencia) => ({
    competencia,
    fonte_canonica: { ...(remoto.get(competencia) || { documentos: 0, valor: 0, documentos_receita: 0, receita: 0, documentos_cancelados: 0, valor_cancelado: 0 }), valor: dinheiro(remoto.get(competencia)?.valor), receita: dinheiro(remoto.get(competencia)?.receita), valor_cancelado: dinheiro(remoto.get(competencia)?.valor_cancelado) },
    cache_local: { ...(local.get(competencia) || { documentos: 0, valor: 0, documentos_receita: 0, receita: 0, documentos_cancelados: 0, valor_cancelado: 0 }), valor: dinheiro(local.get(competencia)?.valor), receita: dinheiro(local.get(competencia)?.receita), valor_cancelado: dinheiro(local.get(competencia)?.valor_cancelado) },
    motor: { ...(motor.get(competencia) || { documentos: 0, valor: 0, documentos_receita: 0, receita: 0, documentos_cancelados: 0, valor_cancelado: 0 }), valor: dinheiro(motor.get(competencia)?.valor), receita: dinheiro(motor.get(competencia)?.receita), valor_cancelado: dinheiro(motor.get(competencia)?.valor_cancelado) },
  }));
}

function linhasLocais(empresaId, competencia) {
  let sql = `SELECT id,empresa_id,tipo,nome,inscr_federal,descricao,ncm,nbs,lc116,cfop,cst,competencia,valor,cclasstrib,modelo_documento_fiscal,documento,item_numero,chave,data_emissao,situacao_documento,origem FROM movimentos WHERE empresa_id=?`;
  const params = [Number(empresaId)];
  if (competencia) { sql += ' AND competencia=?'; params.push(competencia); }
  return db.prepare(sql).all(...params);
}

function resultadosDaUltimaExecucao(empresaId) {
  const execucao = motorExec.ultimaExecucao(Number(empresaId));
  if (!execucao) return { execucao: null, resultados: [] };
  const resultados = db.prepare('SELECT movimento_id,execucao_id,preco_atual FROM motor_resultados WHERE empresa_id=? AND execucao_id=?').all(Number(empresaId), execucao.id);
  return { execucao: { id: execucao.id, concluido_em: execucao.concluido_em || null }, resultados };
}

async function linhasCanonicas(cnpj, competencia) {
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN READ ONLY');
    const empresa = await cliente.query("SELECT id FROM public.empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1 LIMIT 2", [digitos(cnpj)]);
    if (empresa.rows.length !== 1) throw new Error('Empresa compartilhada nao identificada unicamente para a auditoria.');
    const parametros = [empresa.rows[0].id];
    let filtro = '';
    if (competencia) { parametros.push(competencia); filtro = ` AND competencia=$${parametros.length}`; }
    const dados = await cliente.query(`SELECT id,empresa_id,tipo,nome,inscr_federal,descricao,ncm,nbs,lc116,cfop,cst,competencia,valor,cclasstrib,modelo_documento_fiscal,documento,item_numero,chave,data_emissao,situacao_documento,origem FROM public.movimentos WHERE empresa_id=$1${filtro}`, parametros);
    await cliente.query('ROLLBACK');
    return dados.rows;
  } catch (erro) {
    try { await cliente.query('ROLLBACK'); } catch (_) { /* transacao ja encerrada */ }
    throw erro;
  } finally { cliente.release(); }
}

function existeTabelaLocal(tabela) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));
}

function registrosLocais(tabela, empresaId) {
  if (!existeTabelaLocal(tabela)) return [];
  return db.prepare(`SELECT * FROM ${tabela} WHERE empresa_id=?`).all(Number(empresaId));
}

async function registrosCanonicos(cnpj, tabela) {
  if (!TABELAS_ADICIONAIS.has(tabela)) throw new Error('Tabela não permitida para auditoria.');
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN READ ONLY');
    const empresa = await cliente.query("SELECT id FROM public.empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1 LIMIT 2", [digitos(cnpj)]);
    if (empresa.rows.length !== 1) throw new Error('Empresa compartilhada não identificada unicamente para a auditoria.');
    const dados = await cliente.query(`SELECT * FROM public.${tabela} WHERE empresa_id=$1`, [empresa.rows[0].id]);
    await cliente.query('ROLLBACK');
    return dados.rows;
  } catch (erro) {
    try { await cliente.query('ROLLBACK'); } catch (_) { /* transação já encerrada */ }
    throw erro;
  } finally { cliente.release(); }
}

async function auditarLeitura(tabela, empresa) {
  try {
    const [canonicos, locais] = await Promise.all([registrosCanonicos(empresa.cnpj, tabela), Promise.resolve(registrosLocais(tabela, empresa.id))]);
    return { disponivel:true, ...compararRegistros(tabela, canonicos, locais) };
  } catch (erro) {
    // Uma tela não auditável nunca pode ser tratada como conferida. O retorno
    // explícito mantém a lacuna visível sem bloquear o diagnóstico das demais.
    return { disponivel:false, tabela, motivo:erro.message, resumo:{ NAO_AUDITADA:1 }, divergencias:[] };
  }
}

async function auditar(empresaId, opcoes = {}) {
  const empresa = db.prepare('SELECT id,cnpj,razao_social FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.cnpj) throw new Error('Empresa nao localizada para a auditoria.');
  const competencia = texto(opcoes.competencia) || null;
  const [canonicos, locais] = await Promise.all([linhasCanonicas(empresa.cnpj, competencia), Promise.resolve(linhasLocais(empresa.id, competencia))]);
  const fotografia = resultadosDaUltimaExecucao(empresa.id);
  const resultados = competencia
    ? fotografia.resultados.filter((resultado) => locais.some((linha) => Number(linha.id) === Number(resultado.movimento_id)))
    : fotografia.resultados;
  const divergencias = compararCamadas(canonicos, locais, resultados);
  const resumo = divergencias.reduce((acc, linha) => { acc[linha.status] = (acc[linha.status] || 0) + 1; return acc; }, {});
  const totais = totaisPorCompetencia(canonicos, locais, resultados);
  const [fornecedores, outrasReceitas, perfilTributario, perfilCbs] = await Promise.all([
    auditarLeitura('parceiros', empresa),
    auditarLeitura('receitas_sem_dfe', empresa),
    auditarLeitura('perfil_tributario', empresa),
    auditarLeitura('perfil_cbs_competencias', empresa),
  ]);
  return {
    somente_leitura: true,
    empresa: { id: empresa.id, cnpj: empresa.cnpj, razao_social: empresa.razao_social },
    competencia,
    gerado_em: new Date().toISOString(),
    fotografia_motor: fotografia.execucao,
    resumo,
    totais_por_competencia: totais,
    divergencias,
    leituras: {
      documentos_fiscais:{ disponivel:true, resumo, total_canonico:canonicos.length, total_cache_local:locais.length, divergencias },
      fornecedores,
      outras_receitas:outrasReceitas,
      perfil_tributario:perfilTributario,
      perfil_cbs:perfilCbs,
      cadeia_fornecedores:{ disponivel:false, resumo:{ NAO_AUDITADA:1 }, divergencias:[], motivo:'Depende simultaneamente de documentos, parceiros e fotografia do motor; a regra de composição ainda será certificada por tela.' },
      cadeia_clientes:{ disponivel:false, resumo:{ NAO_AUDITADA:1 }, divergencias:[], motivo:'Depende simultaneamente de documentos, parceiros e fotografia do motor; a regra de composição ainda será certificada por tela.' },
      auditoria_mensal:{ disponivel:false, resumo:{ NAO_AUDITADA:1 }, divergencias:[], motivo:'Depende de documentos, outras receitas e apurações; a composição mensal ainda será certificada por tela.' },
      conformidade:{ disponivel:false, resumo:{ NAO_AUDITADA:1 }, divergencias:[], motivo:'Depende de evidências fiscais e da classificação materializada; a leitura ainda será certificada por tela.' },
    },
    certificado: { algoritmo: 'sha256', assinatura: hash({ empresa: empresa.id, competencia, canonicos: canonicos.map(conteudoComparavel), locais: locais.map(conteudoComparavel), resultados }) },
  };
}

module.exports = { chaveIdentidade, conteudoComparavel, compararCamadas, compararRegistros, totaisPorCompetencia, auditar };

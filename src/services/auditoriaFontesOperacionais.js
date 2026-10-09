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
      const atual = mapa.get(competencia) || { documentos: 0, valor: 0 };
      atual.documentos += 1;
      atual.valor += numero(linha[campoValor]);
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
    const atual = motor.get(competencia) || { documentos: 0, valor: 0 };
    atual.documentos += 1;
    atual.valor += numero(resultado.preco_atual);
    motor.set(competencia, atual);
  }
  const competencias = new Set([...remoto.keys(), ...local.keys(), ...motor.keys()]);
  return [...competencias].sort().map((competencia) => ({
    competencia,
    fonte_canonica: { ...(remoto.get(competencia) || { documentos: 0, valor: 0 }), valor: dinheiro(remoto.get(competencia)?.valor) },
    cache_local: { ...(local.get(competencia) || { documentos: 0, valor: 0 }), valor: dinheiro(local.get(competencia)?.valor) },
    motor: { ...(motor.get(competencia) || { documentos: 0, valor: 0 }), valor: dinheiro(motor.get(competencia)?.valor) },
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
  return {
    somente_leitura: true,
    empresa: { id: empresa.id, cnpj: empresa.cnpj, razao_social: empresa.razao_social },
    competencia,
    gerado_em: new Date().toISOString(),
    fotografia_motor: fotografia.execucao,
    resumo,
    totais_por_competencia: totais,
    divergencias,
    certificado: { algoritmo: 'sha256', assinatura: hash({ empresa: empresa.id, competencia, canonicos: canonicos.map(conteudoComparavel), locais: locais.map(conteudoComparavel), resultados }) },
  };
}

module.exports = { chaveIdentidade, conteudoComparavel, compararCamadas, totaisPorCompetencia, auditar };

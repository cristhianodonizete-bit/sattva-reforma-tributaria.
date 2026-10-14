/* Perfil CBS: camada de consolidação. Não executa regra tributária. */
const db = require('../db');
const motorExec = require('./motorExec');
const periodoAnalisado = require('./periodoAnalisado');
const receitaOperacional = require('./receitaOperacional');

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const r6 = (v) => Math.round(n(v) * 1e6) / 1e6;
const soma = (o, k, v) => { o[k] = r2(n(o[k]) + n(v)); };

// Perfil CBS é derivado exclusivamente da fotografia materializada do motor.
// Reutilizar o perfil por execução evita nova leitura, desserialização e escrita
// em perfil_cbs_competencias a cada abertura da visão de impacto. Execução nova
// recebe chave nova, portanto um resultado fiscal atualizado nunca é reutilizado.
const LIMITE_PERFIS_EM_MEMORIA = 12;
const perfisPorExecucao = new Map();
function invalidarMemoria() { perfisPorExecucao.clear(); }
function guardarPerfil(empresaId, execucaoId, competencias, escopo = 'sem-periodo') {
  const chave = `${empresaId}:${execucaoId}:${escopo}`;
  perfisPorExecucao.set(chave, competencias);
  for (const chaveExistente of [...perfisPorExecucao.keys()]) {
    if (chaveExistente !== chave && chaveExistente.startsWith(`${empresaId}:`)) perfisPorExecucao.delete(chaveExistente);
  }
  while (perfisPorExecucao.size > LIMITE_PERFIS_EM_MEMORIA) perfisPorExecucao.delete(perfisPorExecucao.keys().next().value);
  return competencias;
}

function naturezaApresentacao(linha, detalhe) {
  if (['REQUER_VALIDACAO', 'SEM_CORRESPONDENCIA', 'DADOS_INSUFICIENTES'].includes(linha.status_classificacao)
    || ['SUJEITO_VALIDACAO', 'DADOS_INSUFICIENTES'].includes(linha.status_credito)) return 'INDETERMINADO';
  if (String(linha.natureza || detalhe?.natureza).toUpperCase() === 'SIMULADO') return 'SIMULADO';
  // A atual arquitetura do motor produz cálculo a partir das evidências.
  // REAL é reservado para valor que venha diretamente destacado no documento.
  if (detalhe?.reconstrucao?.origem === 'documento') return 'REAL';
  return 'CALCULADO';
}

function grupoTratamento(linha) {
  if (linha.status_classificacao !== 'CLASSIFICADO') return 'receita_tratamento_indeterminado_cbs';
  const t = String(linha.tratamento || '').toLowerCase();
  if (/governo|governamental|compra governamental/.test(t)) return 'receita_beneficio_governo_cbs';
  if (/imun/.test(t)) return 'receita_imunidade_cbs';
  if (/zero|alíquota zero|aliquota zero/.test(t)) return 'receita_aliquota_zero_cbs';
  if (/redu/.test(t)) return 'receita_reducao_cbs';
  if (/espec|diferenciado|monof/.test(t)) return 'receita_regime_especifico_cbs';
  return 'receita_tributacao_integral';
}

function grupoCredito(linha, detalhe) {
  const tipo = String(linha.tipo_credito || '').toUpperCase();
  if (tipo === 'NORMAL') return 'compras_credito_normal';
  if (tipo === 'SIMPLES') return linha.status_credito_determinacao === 'INDETERMINADO' ? 'compras_credito_indeterminado' : 'compras_credito_simples';
  if (tipo === 'PRESUMIDO') return 'compras_credito_presumido';
  if (tipo === 'SEM_CREDITO') return 'compras_sem_credito';
  const s = String(linha.status_credito || '').toUpperCase();
  if (s === 'PROJETADO') return 'compras_credito_normal';
  if (s === 'PROJETADO_LIMITADO') return /simples|mei/.test(String(detalhe?.regimeEmitente || '')) ? 'compras_credito_simples' : 'compras_credito_limitado';
  if (s === 'CREDITO_PRESUMIDO') return 'compras_credito_presumido';
  if (s === 'SEM_DIREITO') return 'compras_sem_credito';
  return 'compras_credito_indeterminado';
}

function dadosPorCompetencia(empresaId, execucaoId, periodo, movimentoIds = []) {
  // Uma competência só pode ser consolidada a partir da fotografia ativa. Sem
  // este recorte, execuções históricas seriam somadas à execução vigente e a
  // auditoria passaria a divergir do Perfil Tributário confirmado.
  if (!Number.isInteger(Number(execucaoId)) || Number(execucaoId) <= 0) return [];
  if (!Array.isArray(movimentoIds) || movimentoIds.length === 0) {
    throw new Error('MATERIALIZACAO_GLOBAL_PROIBIDA: Perfil CBS exige movimento_ids explícitos. Use listar() para leitura analítica.');
  }
  const marcadores = movimentoIds.map(() => '?').join(',');
  return db.prepare(`SELECT r.*, m.competencia, m.documento, m.chave, m.descricao, m.ncm, m.nbs, m.cfop, m.modelo_documento_fiscal, m.origem,
      m.nome, m.inscr_federal, m.tipo AS tipo_movimento
    FROM motor_resultados r JOIN movimentos m ON m.id=r.movimento_id
    LEFT JOIN projecoes_movimentos_estado pe ON pe.empresa_id=r.empresa_id AND pe.movimento_id=r.movimento_id
    WHERE r.empresa_id=? AND r.execucao_id=? AND r.movimento_id IN (${marcadores}) AND pe.situacao='ATUAL' AND COALESCE(m.competencia,'')<>''
    ORDER BY m.competencia, r.id`).all(empresaId, Number(execucaoId), ...movimentoIds)
    .filter((x) => !periodo || periodoAnalisado.noPeriodo(x.competencia, periodo))
    .filter((x) => x.sentido !== 'saida'
      || receitaOperacional.compoeReceita({ ...x, tipo:x.tipo_movimento })
      || receitaOperacional.efeitoBase({ ...x, tipo:x.tipo_movimento }) === 'REDUZ_FORNECEDOR');
}

function materializar(empresaId, opcoes = {}) {
  const movimentoIds = Array.isArray(opcoes.movimentoIds) ? opcoes.movimentoIds.map(Number).filter(Number.isFinite) : [];
  if (!movimentoIds.length) {
    throw new Error('MATERIALIZACAO_GLOBAL_PROIBIDA: Perfil CBS exige movimento_ids explícitos. Use listar() para leitura analítica.');
  }
  invalidarMemoria();
  const foto = motorExec.fotografiaOficial(empresaId);
  if (foto.status !== 'OK') return { status:'ATUALIZACAO_NECESSARIA', motivo:foto.motivo, execucao:null, competencias:[], motorExecutado:false };
  const execucao = foto.execucao;
  // A consolidação não possui motor próprio: quando há mudança, pede ao
  // orquestrador que atualize apenas as linhas invalidadas. A execução
  // integral continua exclusiva do comando administrativo explícito.
  // Perfil CBS é exclusivamente uma materialização. A atualização do motor é
  // orquestrada antes por importação, alteração de regra ou fila incremental;
  // esta leitura nunca pode recalcular a situação-base por conta própria.
  const motorExecutado = false;
  if (!execucao) return { execucao: null, competencias: [] };
  const periodo = periodoAnalisado.obter(empresaId);
  const escopo = periodo ? `${periodo.competencia_inicio}:${periodo.competencia_fim}` : 'sem-periodo';
  const chave = `${empresaId}:${execucao.id}:${escopo}:${movimentoIds.slice().sort((a,b)=>a-b).join(',')}`;
  const emMemoria = perfisPorExecucao.get(chave);
  if (emMemoria) return { execucao, competencias: emMemoria, motorExecutado };

  const grupos = new Map();
  for (const linha of dadosPorCompetencia(empresaId, execucao.id, periodo, movimentoIds)) {
    const competencia = linha.competencia;
    if (!grupos.has(competencia)) grupos.set(competencia, { empresa_id: empresaId, competencia,
      receita_bruta: 0, compras_brutas: 0, base_economica_saidas: 0, base_economica_entradas: 0,
      cbs_debito: 0, cbs_credito: 0, cbs_liquida: 0,
      receita_tributacao_integral: 0, receita_reducao_cbs: 0, receita_aliquota_zero_cbs: 0,
      receita_imunidade_cbs: 0, receita_regime_especifico_cbs: 0, receita_beneficio_governo_cbs: 0,
      receita_tratamento_indeterminado_cbs: 0, compras_credito_normal: 0, compras_credito_limitado: 0,
      compras_credito_simples: 0, compras_credito_presumido: 0, compras_sem_credito: 0,
      compras_credito_indeterminado: 0, _classificado: 0, _base: 0, _credito: 0, _entradas: 0,
      _naturezas: { REAL: 0, CALCULADO: 0, SIMULADO: 0, INDETERMINADO: 0 }, _documentos: new Set(), quantidade_operacoes: 0 });
    const g = grupos.get(competencia); const valor = n(linha.preco_atual); const base = n(linha.base_economica);
    const detalhe = JSON.parse(linha.detalhe || '{}'); const natureza = naturezaApresentacao(linha, detalhe);
    g.quantidade_operacoes++; g._documentos.add(linha.documento || linha.chave || `movimento-${linha.movimento_id}`);
    soma(g._naturezas, natureza, valor);
    if (Number.isFinite(Number(linha.base_economica))) soma(g, '_base', valor);
    const efeitoBase = receitaOperacional.efeitoBase({ ...linha, tipo:linha.tipo_movimento });
    if (efeitoBase === 'REDUZ_FORNECEDOR') {
      // A devolução física ao fornecedor é uma saída, mas economicamente
      // desfaz uma compra anterior. Reduz compras/base de entradas sem virar
      // faturamento nem gerar débito CBS artificial.
      soma(g, 'compras_brutas', -valor); soma(g, 'base_economica_entradas', -base); soma(g, '_entradas', -valor);
    } else if (linha.sentido === 'saida') {
      soma(g, 'receita_bruta', valor); soma(g, 'base_economica_saidas', base); soma(g, 'cbs_debito', linha.cbs);
      soma(g, grupoTratamento(linha), valor);
      if (linha.status_classificacao === 'CLASSIFICADO') soma(g, '_classificado', valor);
    } else {
      soma(g, 'compras_brutas', valor); soma(g, 'base_economica_entradas', base); soma(g, 'cbs_credito', linha.credito_cbs);
      soma(g, grupoCredito(linha, detalhe), valor); soma(g, '_entradas', valor);
      if (['DETERMINADO', 'SUJEITO_VALIDACAO'].includes(linha.status_credito_determinacao) || ['PROJETADO', 'PROJETADO_LIMITADO', 'CREDITO_PRESUMIDO', 'SEM_DIREITO'].includes(linha.status_credito)) soma(g, '_credito', valor);
    }
  }
  const colunas = ['empresa_id','competencia','receita_bruta','compras_brutas','base_economica_saidas','base_economica_entradas','cbs_debito','cbs_credito','cbs_liquida','aliquota_efetiva_cbs_saida','taxa_recuperacao_cbs_entrada','receita_tributacao_integral','receita_reducao_cbs','receita_aliquota_zero_cbs','receita_imunidade_cbs','receita_regime_especifico_cbs','receita_beneficio_governo_cbs','receita_tratamento_indeterminado_cbs','compras_credito_normal','compras_credito_limitado','compras_credito_simples','compras_credito_presumido','compras_sem_credito','compras_credito_indeterminado','cobertura_classificacao_cbs','cobertura_base_economica','cobertura_credito_cbs','percentual_real','percentual_calculado','percentual_simulado','percentual_indeterminado','quantidade_documentos','quantidade_operacoes','motor_execucao_id'];
  const sql = `INSERT INTO perfil_cbs_competencias (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')}) ON CONFLICT(empresa_id,competencia) DO UPDATE SET ${colunas.filter((c) => !['empresa_id','competencia'].includes(c)).map((c) => `${c}=excluded.${c}`).join(',')}, atualizado_em=datetime('now','localtime')`;
  const ins = db.prepare(sql); const saida = [];
  db.transaction(() => { for (const g of grupos.values()) {
    g.cbs_liquida = r2(g.cbs_debito - g.cbs_credito);
    g.aliquota_efetiva_cbs_saida = g.base_economica_saidas ? r6(g.cbs_debito / g.base_economica_saidas) : null;
    g.taxa_recuperacao_cbs_entrada = g.base_economica_entradas ? r6(g.cbs_credito / g.base_economica_entradas) : null;
    g.cobertura_classificacao_cbs = g.receita_bruta ? r6(g._classificado / g.receita_bruta) : null;
    g.cobertura_base_economica = (g.receita_bruta + g.compras_brutas) ? r6(g._base / (g.receita_bruta + g.compras_brutas)) : null;
    g.cobertura_credito_cbs = g._entradas ? r6(g._credito / g._entradas) : null;
    const total = g.receita_bruta + g.compras_brutas;
    for (const k of ['REAL','CALCULADO','SIMULADO','INDETERMINADO']) g[`percentual_${k.toLowerCase()}`] = total ? r6(g._naturezas[k] / total) : null;
    g.quantidade_documentos = g._documentos.size; g.motor_execucao_id = execucao.id;
    ins.run(...colunas.map((c) => g[c] ?? null)); saida.push(g);
  }} )();
  return { execucao, periodo_analisado:periodo || null, competencias: guardarPerfil(empresaId, execucao.id, saida, escopo), motorExecutado };
}

function listar(empresaId, filtros={}) {
  const fotografia=motorExec.fotografiaOficial(empresaId);
  if(fotografia.status!=='OK') return { status:'ATUALIZACAO_NECESSARIA', motivo:fotografia.motivo, execucao:null, itens:[],paginacao:{limite:0,cursor:null,tem_proxima:false} };
  const execucaoId=Number(fotografia.execucao.id);
  const limite=Math.min(100,Math.max(1,Number(filtros.limite)||100));
  const cursor=String(filtros.cursor||'');
  const p=[empresaId,execucaoId]; let onde='empresa_id=? AND motor_execucao_id=?';
  if (cursor) { onde+=' AND competencia<?'; p.push(cursor); }
  const linhas=db.prepare(`SELECT id,empresa_id,competencia,receita_bruta,compras_brutas,base_economica_saidas,
    base_economica_entradas,cbs_debito,cbs_credito,cbs_liquida,aliquota_efetiva_cbs_saida,
    taxa_recuperacao_cbs_entrada,receita_tributacao_integral,receita_reducao_cbs,
    receita_aliquota_zero_cbs,receita_imunidade_cbs,receita_regime_especifico_cbs,
    receita_beneficio_governo_cbs,receita_tratamento_indeterminado_cbs,compras_credito_normal,
    compras_credito_limitado,compras_credito_simples,compras_credito_presumido,compras_sem_credito,
    compras_credito_indeterminado,cobertura_classificacao_cbs,cobertura_base_economica,
    cobertura_credito_cbs,percentual_real,percentual_calculado,percentual_simulado,
    percentual_indeterminado,quantidade_documentos,quantidade_operacoes,motor_execucao_id,atualizado_em
    FROM perfil_cbs_competencias WHERE ${onde} ORDER BY competencia DESC LIMIT ?`).all(...p,limite);
  const paginacao={limite,cursor:linhas.at(-1)?.competencia||null,tem_proxima:linhas.length===limite};
  if(!linhas.length && !cursor){
    const total=Number(db.prepare('SELECT COUNT(*) AS total FROM motor_resultados WHERE empresa_id=? AND execucao_id=?').get(empresaId,execucaoId)?.total || 0);
    if(total>0) return {status:'AGREGADO_PENDENTE',motivo:'Fotografia oficial sem agregado Perfil CBS persistido para esta execução.',execucao:fotografia.execucao,itens:[],paginacao};
  }
  return {status:'OK',execucao:fotografia.execucao,itens:linhas,paginacao};
}
function detalhes(empresaId, competencia, filtros = {}) {
  const fotografia=motorExec.fotografiaOficial(empresaId);
  if(fotografia.status!=='OK') return {status:'ATUALIZACAO_NECESSARIA',motivo:fotografia.motivo,itens:[]};
  const limite=Math.min(100,Math.max(1,Number(filtros.limite)||100));
  let sql = `SELECT r.id resultado_id,r.movimento_id,r.sentido,r.status_classificacao,r.status_credito,r.preco_atual,r.base_economica,r.ibs,r.cbs,r.credito_ibs,r.credito_cbs,r.cst,r.cclasstrib,r.tratamento,
    m.competencia,m.documento,m.chave,m.descricao,m.ncm,m.nbs,m.cfop,m.origem,m.nome,m.inscr_federal
    FROM motor_resultados r JOIN movimentos m ON m.id=r.movimento_id AND m.empresa_id=r.empresa_id
    LEFT JOIN projecoes_movimentos_estado pe ON pe.empresa_id=r.empresa_id AND pe.movimento_id=r.movimento_id
    WHERE r.empresa_id=? AND r.execucao_id=? AND m.competencia=? AND pe.situacao='ATUAL'`;
  const p = [empresaId,Number(fotografia.execucao.id),competencia]; if (filtros.sentido) { sql += ' AND r.sentido=?'; p.push(filtros.sentido); }
  return {status:'OK',execucao:fotografia.execucao,itens:db.prepare(`${sql} ORDER BY r.preco_atual DESC,r.id DESC LIMIT ?`).all(...p,limite)};
}
module.exports = { materializar, listar, detalhes, naturezaApresentacao, invalidarMemoria };

/**
 * Central de exceções do motor.
 *
 * Consolida automaticamente somente situações que não foram resolvidas por
 * documento, cadastro, catálogo ou regra. A prioridade é materialidade: valor
 * envolvido e impacto CBS estimado. Nenhuma exceção altera o cálculo.
 */
const db = require('../db');

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;

function candidatas(linha) {
  let detalhe = {};
  try { detalhe = JSON.parse(linha.detalhe || '{}'); } catch (_) { detalhe = {}; }
  const lista = [];
  const add = (codigo, categoria, gravidade, texto, origem = 'MOTOR') => lista.push({
    codigo, categoria, gravidade, texto, origem,
  });

  if (linha.status_classificacao === 'SEM_CORRESPONDENCIA') {
    add('CLASSIFICACAO_SEM_CORRESPONDENCIA', 'Classificação fiscal', 'alta',
      'NCM/NBS sem correspondência determinística no catálogo.');
  }
  if (linha.status_classificacao === 'REQUER_VALIDACAO') {
    add('CLASSIFICACAO_REQUER_VALIDACAO', 'Classificação fiscal', 'alta',
      'Há mais de uma classificação possível ou condição fiscal não comprovada.');
  }
  if (['DADOS_INSUFICIENTES', 'SUJEITO_VALIDACAO', 'INDETERMINADO'].includes(linha.status_credito_determinacao || linha.status_credito)) {
    add('CREDITO_INDETERMINADO', 'Crédito CBS', 'media',
      'O crédito não foi convertido em zero: faltam evidências para concluí-lo.');
  }
  if (detalhe.reconstrucao?.status && detalhe.reconstrucao.status !== 'reconstruida') {
    add('BASE_ECONOMICA_INSEGURA', 'Base econômica', detalhe.reconstrucao.status === 'estimada' ? 'media' : 'alta',
      detalhe.reconstrucao.status === 'estimada'
        ? 'Base econômica composta com premissa identificada.'
        : 'Base econômica não pôde ser reconstruída com segurança.');
  }
  if (detalhe.conferencia?.confere === false) {
    add('DIVERGENCIA_DOCUMENTO_PROJECAO', 'Conferência fiscal', 'alta',
      'IBS/CBS declarado no documento diverge da projeção para a mesma operação.', 'DOCUMENTO');
  }
  if (detalhe.classificacao?.divergencia) {
    add('DIVERGENCIA_CLASSIFICACAO_DECLARADA', 'Classificação fiscal', 'alta',
      'A classificação declarada diverge da classificação determinada pelo catálogo.', 'DOCUMENTO');
  }
  if (String(linha.natureza || '').toUpperCase() === 'INDETERMINADO' && !lista.length) {
    add('RESULTADO_INDETERMINADO', 'Determinação', 'media',
      'Resultado indeterminado preservado para análise por exceção.');
  }
  return lista;
}

function sincronizar(empresaId, execucaoId) {
  const linhas = db.prepare('SELECT * FROM motor_resultados WHERE empresa_id=? AND execucao_id=?').all(empresaId, execucaoId);
  const agora = new Date().toISOString();
  const salvarHistorico = db.prepare(`INSERT INTO excecoes_motor
    (empresa_id,movimento_id,execucao_id,codigo,categoria,gravidade,status,natureza,origem,valor_envolvido,impacto_cbs_estimado,materialidade,detalhe,criado_em,atualizado_em)
    VALUES (?,?,?,?,?,?, 'ABERTA',?,?,?,?,?,?,?,?)
    ON CONFLICT(empresa_id,movimento_id,codigo) DO UPDATE SET
      execucao_id=excluded.execucao_id,categoria=excluded.categoria,gravidade=excluded.gravidade,status='ABERTA',natureza=excluded.natureza,origem=excluded.origem,
      valor_envolvido=excluded.valor_envolvido,impacto_cbs_estimado=excluded.impacto_cbs_estimado,materialidade=excluded.materialidade,detalhe=excluded.detalhe,atualizado_em=excluded.atualizado_em,resolvido_em=NULL`);

  const salvarExecucao = db.prepare(`INSERT INTO excecoes_motor_execucoes
    (empresa_id,execucao_id,movimento_id,codigo,categoria,gravidade,status,natureza,origem,valor_envolvido,impacto_cbs_estimado,materialidade,detalhe,criado_em)
    VALUES (?,?,?,?,?,?, 'ABERTA',?,?,?,?,?,?,?)
    ON CONFLICT(empresa_id,execucao_id,movimento_id,codigo) DO UPDATE SET
      categoria=excluded.categoria,gravidade=excluded.gravidade,status='ABERTA',natureza=excluded.natureza,origem=excluded.origem,
      valor_envolvido=excluded.valor_envolvido,impacto_cbs_estimado=excluded.impacto_cbs_estimado,materialidade=excluded.materialidade,detalhe=excluded.detalhe`);

  db.transaction(() => {
    for (const linha of linhas) {
      for (const x of candidatas(linha)) {
        const valor = Math.abs(n(linha.preco_atual));
        const impacto = Math.abs(n(linha.cbs)) + Math.abs(n(linha.credito_cbs));
        const payload = JSON.stringify({ mensagem: x.texto, motor_resultado_id: linha.id, status_classificacao: linha.status_classificacao,
          status_credito: linha.status_credito_determinacao || linha.status_credito, natureza: linha.natureza });
        salvarHistorico.run(empresaId, linha.movimento_id, execucaoId, x.codigo, x.categoria, x.gravidade,
          linha.natureza || 'INDETERMINADO', x.origem, r2(valor), r2(impacto), r2(Math.max(valor, impacto)),
          payload, agora, agora);
        salvarExecucao.run(empresaId, execucaoId, linha.movimento_id, x.codigo, x.categoria, x.gravidade,
          linha.natureza || 'INDETERMINADO', x.origem, r2(valor), r2(impacto), r2(Math.max(valor, impacto)), payload, agora);
      }
    }
  })();
  return resumo(empresaId, execucaoId);
}

function execucaoAtiva(empresaId) {
  return db.prepare('SELECT id FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(empresaId)?.id || null;
}

function resumo(empresaId, execucaoInformada = null) {
  const execucaoId = execucaoInformada || execucaoAtiva(empresaId);
  if (!execucaoId) return { execucao_ativa: null, abertas: 0, valor_envolvido: 0, impacto_cbs_estimado: 0, por_categoria: [] };
  const abertas = db.prepare(`SELECT COUNT(*) quantidade, COALESCE(SUM(valor_envolvido),0) valor, COALESCE(SUM(impacto_cbs_estimado),0) impacto
    FROM excecoes_motor_execucoes WHERE empresa_id=? AND execucao_id=? AND status='ABERTA'`).get(empresaId, execucaoId);
  const porCategoria = db.prepare(`SELECT categoria, gravidade, COUNT(*) quantidade, COALESCE(SUM(valor_envolvido),0) valor_envolvido,
    COALESCE(SUM(impacto_cbs_estimado),0) impacto_cbs_estimado FROM excecoes_motor_execucoes WHERE empresa_id=? AND execucao_id=? AND status='ABERTA'
    GROUP BY categoria,gravidade ORDER BY valor_envolvido DESC, impacto_cbs_estimado DESC`).all(empresaId, execucaoId);
  return { execucao_ativa: execucaoId, abertas: abertas.quantidade || 0, valor_envolvido: r2(abertas.valor), impacto_cbs_estimado: r2(abertas.impacto), por_categoria: porCategoria };
}

function listar(empresaId, filtros = {}) {
  const ativa = execucaoAtiva(empresaId);
  const limite = Math.min(Number(filtros.limite) || 100, 5000);
  const historico = String(filtros.visao || '').toLowerCase() === 'historico';
  const tabela = historico ? 'excecoes_motor' : 'excecoes_motor_execucoes';
  let sql = `SELECT *, ${historico ? "CASE WHEN execucao_id=? THEN status WHEN status='ABERTA' THEN 'SUPERADA_POR_NOVA_EXECUCAO' ELSE status END" : "'ABERTA'"} AS status_execucao FROM ${tabela} WHERE empresa_id=?`;
  const p = historico ? [ativa, empresaId] : [empresaId];
  if (!historico) { sql += ' AND execucao_id=? AND status=\'ABERTA\''; p.push(ativa); }
  else if (filtros.status) { sql += ' AND status=?'; p.push(filtros.status); }
  sql += ' ORDER BY materialidade DESC, valor_envolvido DESC, id DESC LIMIT ?'; p.push(limite);
  return db.prepare(sql).all(...p).map((x) => ({ ...x, execucao_ativa: Number(x.execucao_id) === Number(ativa), detalhe: (() => { try { return JSON.parse(x.detalhe || '{}'); } catch (_) { return {}; } })() }));
}

module.exports = { sincronizar, resumo, listar, candidatas };

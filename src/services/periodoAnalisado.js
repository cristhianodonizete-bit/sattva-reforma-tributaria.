const dbPadrao = require('../db');

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const texto = (v) => String(v || '').trim();
const competenciaValida = (v) => COMPETENCIA.test(texto(v));
const dataInicio = (competencia) => `${competencia}-01`;
const dataFim = (competencia) => {
  const [ano, mes] = competencia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
};

function obter(empresaId, { banco = dbPadrao } = {}) {
  return banco.prepare('SELECT * FROM empresa_periodo_analisado WHERE empresa_id=?').get(Number(empresaId)) || null;
}

function salvar(empresaId, dados, usuarioId = null, { banco = dbPadrao } = {}) {
  const inicio = texto(dados.competencia_inicio); const fim = texto(dados.competencia_fim);
  if (!competenciaValida(inicio) || !competenciaValida(fim) || inicio > fim) throw new Error('Informe competências válidas, de mm/aaaa inicial até mm/aaaa final.');
  if (!banco.prepare('SELECT id FROM empresas WHERE id=?').get(Number(empresaId))) throw new Error('Empresa não encontrada.');
  const anterior = obter(empresaId, { banco });
  banco.transaction(() => {
    banco.prepare(`INSERT INTO empresa_periodo_analisado
      (empresa_id,competencia_inicio,competencia_fim,data_inicio,data_fim,atualizado_por,atualizado_em)
      VALUES (?,?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(empresa_id) DO UPDATE SET competencia_inicio=excluded.competencia_inicio,competencia_fim=excluded.competencia_fim,
        data_inicio=excluded.data_inicio,data_fim=excluded.data_fim,atualizado_por=excluded.atualizado_por,atualizado_em=datetime('now','localtime')`)
      .run(Number(empresaId), inicio, fim, dataInicio(inicio), dataFim(fim), usuarioId || null);
    banco.prepare(`INSERT INTO empresa_periodo_analisado_eventos
      (empresa_id,acao,usuario_id,antes_json,depois_json) VALUES (?,?,?,?,?)`)
      .run(Number(empresaId), anterior ? 'ATUALIZADO' : 'DEFINIDO', usuarioId || null, JSON.stringify(anterior || {}), JSON.stringify({ competencia_inicio:inicio, competencia_fim:fim, data_inicio:dataInicio(inicio), data_fim:dataFim(fim) }));
  })();
  return obter(empresaId, { banco });
}

function exigir(empresaId, { banco = dbPadrao } = {}) {
  const periodo = obter(empresaId, { banco });
  if (!periodo) throw new Error('Defina o Período analisado na Central de Dados antes de importar dados.');
  return periodo;
}

function noPeriodo(competencia, periodo) {
  return competenciaValida(competencia) && competencia >= periodo.competencia_inicio && competencia <= periodo.competencia_fim;
}

function cobertura(empresaId, { banco = dbPadrao } = {}) {
  const periodo = obter(empresaId, { banco });
  if (!periodo) return { periodo:null, competencias:[], faltantes:[], fora_do_periodo:0 };
  const esperadas = []; for (let c=periodo.competencia_inicio; c<=periodo.competencia_fim;) { esperadas.push(c); const [a,m]=c.split('-').map(Number); c=`${m===12?a+1:a}-${String(m===12?1:m+1).padStart(2,'0')}`; }
  const encontradas = banco.prepare(`SELECT DISTINCT competencia FROM (
    SELECT competencia FROM movimentos WHERE empresa_id=? UNION SELECT competencia FROM perfil_tributario WHERE empresa_id=?
    UNION SELECT competencia FROM folhas_pagamento_competencias WHERE empresa_id=? UNION SELECT competencia FROM receitas_sem_dfe WHERE empresa_id=?
  ) WHERE competencia IS NOT NULL AND competencia<>''`).all(empresaId, empresaId, empresaId, empresaId).map((x) => x.competencia);
  const dentro = new Set(encontradas.filter((x) => noPeriodo(x, periodo)));
  return { periodo, competencias:esperadas, cobertas:esperadas.filter((x) => dentro.has(x)), faltantes:esperadas.filter((x) => !dentro.has(x)), fora_do_periodo:encontradas.filter((x) => competenciaValida(x) && !noPeriodo(x, periodo)).length };
}

module.exports = { obter, salvar, exigir, cobertura, noPeriodo, competenciaValida, dataInicio, dataFim };

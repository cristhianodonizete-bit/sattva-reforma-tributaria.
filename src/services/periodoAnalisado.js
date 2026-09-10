const dbPadrao = require('../db');
const supabase = require('./supabase');

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const texto = (v) => String(v || '').trim();
const competenciaValida = (v) => COMPETENCIA.test(texto(v));
const dataInicio = (competencia) => `${competencia}-01`;
const dataFim = (competencia) => {
  const [ano, mes] = competencia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
};
const deslocarMes = (competencia, deslocamento) => { const [ano, mes] = competencia.split('-').map(Number); const d = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const competenciaAbertura = (data) => /^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) ? String(data).slice(0, 7) : null;
function validarAbertura(empresaId, inicio, banco) {
  const empresa = banco.prepare('SELECT data_abertura FROM empresas WHERE id=?').get(Number(empresaId));
  const abertura = competenciaAbertura(empresa?.data_abertura);
  if (abertura && inicio < abertura) throw new Error(`O período analisado só pode começar em ${abertura}, competência de abertura da empresa.`);
  return abertura;
}
function janelaApuracao(periodo) {
  if (!periodo) return null;
  const meses = Math.max(12, Number(periodo.apuracao_meses) || 12);
  const incluiExercicio = Number(periodo.apuracao_inclui_exercicio) !== 0;
  // "Fora do exercício" soma os meses históricos ao exercício escolhido.
  // Ex.: exercício jan–jul/2026 + 12 meses anteriores = jan/2025–jul/2026
  // (19 competências), e não apenas os 12 meses de 2025.
  const fim = periodo.competencia_fim;
  const inicio = incluiExercicio
    ? deslocarMes(fim, -(meses - 1))
    : deslocarMes(periodo.competencia_inicio, -meses);
  const totalMeses = (() => { const [ai, mi] = inicio.split('-').map(Number), [af, mf] = fim.split('-').map(Number); return (af - ai) * 12 + mf - mi + 1; })();
  return { competencia_inicio: inicio, competencia_fim: fim, data_inicio:dataInicio(inicio), data_fim:dataFim(fim), meses:totalMeses, meses_anteriores:meses, inclui_exercicio:incluiExercicio };
}

function obter(empresaId, { banco = dbPadrao } = {}) {
  return banco.prepare('SELECT * FROM empresa_periodo_analisado WHERE empresa_id=?').get(Number(empresaId)) || null;
}

function salvar(empresaId, dados, usuarioId = null, { banco = dbPadrao } = {}) {
  const inicio = texto(dados.competencia_inicio); const fim = texto(dados.competencia_fim);
  if (!competenciaValida(inicio) || !competenciaValida(fim) || inicio > fim) throw new Error('Informe competências válidas, de mm/aaaa inicial até mm/aaaa final.');
  if (!banco.prepare('SELECT id FROM empresas WHERE id=?').get(Number(empresaId))) throw new Error('Empresa não encontrada.');
  validarAbertura(empresaId, inicio, banco);
  const anterior = obter(empresaId, { banco });
  const apuracaoMeses = Math.max(12, Number(dados.apuracao_meses) || Number(anterior?.apuracao_meses) || 12);
  const apuracaoIncluiExercicio = dados.apuracao_inclui_exercicio === false || dados.apuracao_inclui_exercicio === '0' ? 0 : 1;
  banco.transaction(() => {
    banco.prepare(`INSERT INTO empresa_periodo_analisado
      (empresa_id,competencia_inicio,competencia_fim,data_inicio,data_fim,apuracao_meses,apuracao_inclui_exercicio,atualizado_por,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(empresa_id) DO UPDATE SET competencia_inicio=excluded.competencia_inicio,competencia_fim=excluded.competencia_fim,
        data_inicio=excluded.data_inicio,data_fim=excluded.data_fim,apuracao_meses=excluded.apuracao_meses,apuracao_inclui_exercicio=excluded.apuracao_inclui_exercicio,atualizado_por=excluded.atualizado_por,atualizado_em=datetime('now','localtime')`)
      .run(Number(empresaId), inicio, fim, dataInicio(inicio), dataFim(fim), apuracaoMeses, apuracaoIncluiExercicio, usuarioId || null);
    banco.prepare(`INSERT INTO empresa_periodo_analisado_eventos
      (empresa_id,acao,usuario_id,antes_json,depois_json) VALUES (?,?,?,?,?)`)
      .run(Number(empresaId), anterior ? 'ATUALIZADO' : 'DEFINIDO', usuarioId || null, JSON.stringify(anterior || {}), JSON.stringify({ competencia_inicio:inicio, competencia_fim:fim, data_inicio:dataInicio(inicio), data_fim:dataFim(fim), apuracao_meses:apuracaoMeses, apuracao_inclui_exercicio:apuracaoIncluiExercicio }));
  })();
  return obter(empresaId, { banco });
}

// O SQLite é um cache operacional local. A fonte durável para configurações
// compartilhadas é o Supabase; nunca usamos o cache vazio de uma nova
// instância como motivo para remover ou substituir uma configuração remota.
async function empresaRemota(empresaId, banco) {
  if (!supabase.configurado()) return null;
  const local = banco.prepare('SELECT cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!local) throw new Error('Empresa não encontrada.');
  const remoto = supabase.admin();
  const cnpj = String(local.cnpj || '').replace(/\D/g, '');
  const filtro = cnpj ? `origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}` : `origem_local_id.eq.${Number(empresaId)}`;
  const { data, error } = await remoto.from('empresas').select('id,origem_local_id,cnpj').or(filtro).limit(2);
  if (error) throw new Error(`Não foi possível localizar a empresa compartilhada: ${error.message}`);
  if ((data || []).length > 1) throw new Error('Foram encontradas duas identidades compartilhadas para a empresa. Nenhuma configuração foi alterada.');
  return data?.[0] || null;
}

function gravarCache(empresaId, registro, banco) {
  if (!registro) return null;
  banco.prepare(`INSERT INTO empresa_periodo_analisado
    (empresa_id,competencia_inicio,competencia_fim,data_inicio,data_fim,apuracao_meses,apuracao_inclui_exercicio,atualizado_por,atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(empresa_id) DO UPDATE SET competencia_inicio=excluded.competencia_inicio,competencia_fim=excluded.competencia_fim,
      data_inicio=excluded.data_inicio,data_fim=excluded.data_fim,apuracao_meses=excluded.apuracao_meses,apuracao_inclui_exercicio=excluded.apuracao_inclui_exercicio,atualizado_por=excluded.atualizado_por,atualizado_em=excluded.atualizado_em`)
    .run(Number(empresaId), registro.competencia_inicio, registro.competencia_fim, registro.data_inicio, registro.data_fim, Math.max(12,Number(registro.apuracao_meses)||12), registro.apuracao_inclui_exercicio===false||Number(registro.apuracao_inclui_exercicio)===0?0:1,
      registro.atualizado_por || null, registro.atualizado_em || new Date().toISOString());
  return obter(empresaId, { banco });
}

async function sincronizarCompartilhado(empresaId, { banco = dbPadrao } = {}) {
  if (!supabase.configurado()) return obter(empresaId, { banco });
  const empresa = await empresaRemota(empresaId, banco);
  // Instalações locais e empresas ainda não publicadas preservam seu próprio
  // registro; não criamos uma segunda identidade por CNPJ ou nome.
  if (!empresa) return obter(empresaId, { banco });
  const remoto = supabase.admin();
  const { data, error } = await remoto.from('empresa_periodo_analisado').select('*').eq('empresa_id', empresa.id).maybeSingle();
  if (error) throw new Error(`Não foi possível ler o período compartilhado: ${error.message}`);
  return data ? gravarCache(empresaId, data, banco) : obter(empresaId, { banco });
}

async function salvarCompartilhado(empresaId, dados, usuarioId = null, { banco = dbPadrao } = {}) {
  const inicio = texto(dados.competencia_inicio); const fim = texto(dados.competencia_fim);
  if (!competenciaValida(inicio) || !competenciaValida(fim) || inicio > fim) throw new Error('Informe competências válidas, de mm/aaaa inicial até mm/aaaa final.');
  if (!banco.prepare('SELECT id FROM empresas WHERE id=?').get(Number(empresaId))) throw new Error('Empresa não encontrada.');
  validarAbertura(empresaId, inicio, banco);
  if (!supabase.configurado()) return salvar(empresaId, dados, usuarioId, { banco });
  const empresa = await empresaRemota(empresaId, banco);
  if (!empresa) throw new Error('Empresa ainda não está disponível na base compartilhada. A configuração não foi gravada para evitar perda de sincronização.');
  const remoto = supabase.admin();
  const anterior = await sincronizarCompartilhado(empresaId, { banco });
  const apuracaoMeses=Math.max(12,Number(dados.apuracao_meses)||Number(anterior?.apuracao_meses)||12), apuracaoIncluiExercicio=!(dados.apuracao_inclui_exercicio===false||dados.apuracao_inclui_exercicio==='0');
  const registro = { empresa_id:empresa.id, competencia_inicio:inicio, competencia_fim:fim, data_inicio:dataInicio(inicio), data_fim:dataFim(fim), apuracao_meses:apuracaoMeses, apuracao_inclui_exercicio:apuracaoIncluiExercicio, atualizado_por:usuarioId || null, atualizado_em:new Date().toISOString() };
  const { data, error } = await remoto.from('empresa_periodo_analisado').upsert(registro, { onConflict:'empresa_id' }).select().single();
  if (error) throw new Error(`Não foi possível gravar o período compartilhado: ${error.message}`);
  const { error:eventError } = await remoto.from('empresa_periodo_analisado_eventos').insert({ empresa_id:empresa.id, acao:anterior ? 'ATUALIZADO' : 'DEFINIDO', usuario_id:usuarioId || null, antes_json:anterior || {}, depois_json:data });
  if (eventError) console.error('[periodo-analisado] histórico remoto:', eventError.message);
  return gravarCache(empresaId, data, banco);
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
  const empresa = banco.prepare('SELECT data_abertura FROM empresas WHERE id=?').get(Number(empresaId)) || {};
  if (!periodo) return { periodo:null, competencias:[], faltantes:[], fora_do_periodo:0, data_abertura:empresa.data_abertura || null, competencia_abertura:competenciaAbertura(empresa.data_abertura) };
  const esperadas = []; for (let c=periodo.competencia_inicio; c<=periodo.competencia_fim;) { esperadas.push(c); const [a,m]=c.split('-').map(Number); c=`${m===12?a+1:a}-${String(m===12?1:m+1).padStart(2,'0')}`; }
  const encontradas = banco.prepare(`SELECT DISTINCT competencia FROM (
    SELECT competencia FROM movimentos WHERE empresa_id=? UNION SELECT competencia FROM perfil_tributario WHERE empresa_id=?
    UNION SELECT competencia FROM folhas_pagamento_competencias WHERE empresa_id=? UNION SELECT competencia FROM receitas_sem_dfe WHERE empresa_id=?
  ) WHERE competencia IS NOT NULL AND competencia<>''`).all(empresaId, empresaId, empresaId, empresaId).map((x) => x.competencia);
  const dentro = new Set(encontradas.filter((x) => noPeriodo(x, periodo)));
  return { periodo, janela_apuracao:janelaApuracao(periodo), competencias:esperadas, cobertas:esperadas.filter((x) => dentro.has(x)), faltantes:esperadas.filter((x) => !dentro.has(x)), fora_do_periodo:encontradas.filter((x) => competenciaValida(x) && !noPeriodo(x, periodo)).length, data_abertura:empresa.data_abertura || null, competencia_abertura:competenciaAbertura(empresa.data_abertura) };
}

module.exports = { obter, salvar, exigir, cobertura, noPeriodo, competenciaValida, dataInicio, dataFim, deslocarMes, competenciaAbertura, janelaApuracao, sincronizarCompartilhado, salvarCompartilhado };

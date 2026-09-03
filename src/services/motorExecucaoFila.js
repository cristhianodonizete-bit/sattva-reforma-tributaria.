const db = require('../db');
const fila = require('./processamentoCarteira');
const staging = require('./motorStaging');

const TIPO = 'MOTOR_COMPLETO';

async function solicitar(empresaId, opcoes = {}) {
  const empresa = db.prepare('SELECT id FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');
  const ano = String(Number(opcoes.ano) || 2027);
  const processamento = await fila.iniciar({ empresas: [Number(empresaId)], competencia: ano, tipo: TIPO, prioridade: 10,
    payload: { ano: Number(ano), anexo: opcoes.anexo || null, modo: 'FOTOGRAFIA_ATOMICA' }, iniciarWorker: false });
  const job = (processamento.jobs || []).find((x) => Number(x.empresa_id) === Number(empresaId) && x.tipo_job === TIPO) || null;
  return { processamento_id: processamento.id, deduplicado: Boolean(processamento.deduplicado), job };
}

function status(empresaId) {
  const job = db.prepare(`SELECT id,empresa_id,competencia,tipo_job,status,tentativas,max_tentativas,erro,resultado,criado_em,iniciado_em,finalizado_em
    FROM jobs_carteira WHERE empresa_id=? AND tipo_job=? ORDER BY criado_em DESC LIMIT 1`).get(empresaId, TIPO);
  if (!job) return null;
  const foto = staging.consultar(job.id);
  return { ...job, resultado: job.resultado ? JSON.parse(job.resultado) : null, staging: foto,
    estado: foto?.status || job.status };
}

module.exports = { TIPO, solicitar, status };

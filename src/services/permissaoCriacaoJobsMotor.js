const MENSAGEM = 'Criação de job do motor bloqueada por configuração.';

class CriacaoJobsMotorBloqueadaError extends Error {
  constructor() {
    super(MENSAGEM);
    this.name = 'CriacaoJobsMotorBloqueadaError';
    this.codigo = 'MOTOR_CRIACAO_JOBS_BLOQUEADA';
    this.status = 423;
  }
}

function permitida() {
  return String(process.env.MOTOR_CRIACAO_JOBS_PERMITIDA || '').trim().toLowerCase() === 'true';
}

function exigir() {
  if (!permitida()) throw new CriacaoJobsMotorBloqueadaError();
}

module.exports = { MENSAGEM, CriacaoJobsMotorBloqueadaError, permitida, exigir };

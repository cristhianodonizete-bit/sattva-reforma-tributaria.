// Encaminha alterações fiscais já registradas pelo motor para a fila durável.
// Não calcula no processo HTTP e não cria MOTOR_COMPLETO: cada empresa recebe
// somente os IDs que a dependência marcou como afetados.
const db = require('../db');
const motorExec = require('./motorExec');
const fila = require('./motorExecucaoFila');
const permissaoCriacaoJobsMotor = require('./permissaoCriacaoJobsMotor');

// Trava operacional: com REPROCESSAMENTO_AUTOMATICO_PAUSADO=1 nenhuma empresa
// recebe novo pedido incremental automático. Serve para conter um loop de
// reenfileiramento sem derrubar o serviço web.
function pausado() {
  return ['1', 'true', 'sim'].includes(String(process.env.REPROCESSAMENTO_AUTOMATICO_PAUSADO || '').trim().toLowerCase());
}

async function agendarPendencias() {
  if (pausado() || !permissaoCriacaoJobsMotor.permitida()) return [];
  const empresas=db.prepare('SELECT id FROM empresas ORDER BY id').all();
  const resultado=[];
  for (const empresa of empresas) {
    const ids=motorExec.pendentesIncrementais(empresa.id);
    if (!ids.length) continue;
    const pedido=await fila.solicitarIncremental(empresa.id,{ movimentoIds:ids });
    resultado.push({ empresa_id:empresa.id, documentos:ids.length, processamento_id:pedido.processamento_id });
  }
  return resultado;
}

module.exports = { agendarPendencias };

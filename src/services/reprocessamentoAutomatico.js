// Encaminha alterações fiscais já registradas pelo motor para a fila durável.
// Não calcula no processo HTTP e não cria MOTOR_COMPLETO: cada empresa recebe
// somente os IDs que a dependência marcou como afetados.
const db = require('../db');
const motorExec = require('./motorExec');
const fila = require('./motorExecucaoFila');

async function agendarPendencias() {
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

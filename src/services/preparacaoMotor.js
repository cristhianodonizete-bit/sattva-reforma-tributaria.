// Prepara uma única empresa para o motor. Este módulo roda no worker; o HTTP
// não deve aguardar reconciliação documental ou restauração de apurações.
const db = require('../db');
const estadoLeituraEmpresa = require('./estadoLeituraEmpresa');
const periodoAnalisado = require('./periodoAnalisado');
const dadosAdicionaisCompartilhados = require('./dadosAdicionaisCompartilhados');
const pgdasCompartilhado = require('./pgdasCompartilhado');
const pgdasDocumentoIa = require('./pgdasDocumentoIa');
const apuracoesPisCofinsIa = require('./apuracoesPisCofinsIa');
const prontidaoDados = require('./prontidaoDados');
const operacaoCompartilhada = require('./operacaoCompartilhada');

async function preparar(empresaId) {
  const id = Number(empresaId);
  await estadoLeituraEmpresa.atualizarComSeguranca(db, id, ['periodo'], () => periodoAnalisado.sincronizarCompartilhado(id), { motivo:'Período conferido pelo worker' });
  const periodo = periodoAnalisado.obter(id);
  if (!periodo) throw new Error('Defina o Período analisado antes de executar o motor.');
  await estadoLeituraEmpresa.atualizarComSeguranca(db, id, ['receitas'], () => dadosAdicionaisCompartilhados.restaurar(db, id), { motivo:'Receitas complementares conferidas pelo worker' });
  const reconciliacao = await estadoLeituraEmpresa.atualizarComSeguranca(
    db, id, ['documentos', 'cancelamentos'],
    () => operacaoCompartilhada.reconciliarMovimentosEmpresa(id, { competenciaInicio: periodo.competencia_inicio, competenciaFim: periodo.competencia_fim }),
    { motivo:'Documentos canônicos conferidos pelo worker' },
  );
  const empresa = db.prepare('SELECT regime FROM empresas WHERE id=?').get(id);
  if (empresa?.regime === 'simples_nacional') {
    await estadoLeituraEmpresa.atualizarComSeguranca(db, id, ['pgdas'], () => pgdasCompartilhado.restaurar(id), { motivo:'PGDAS confirmado restaurado pelo worker' });
    pgdasDocumentoIa.materializarConfirmados(db, id);
  } else {
    await estadoLeituraEmpresa.atualizarComSeguranca(db, id, ['apuracoes'], () => apuracoesPisCofinsIa.restaurarCompartilhado(db, id), { motivo:'Apurações confirmadas restauradas pelo worker' });
  }
  await estadoLeituraEmpresa.atualizarComSeguranca(db, id, ['prontidao'], () => prontidaoDados.sincronizarCompartilhado(id), { motivo:'Prontidão conferida pelo worker' });
  const prontidao = prontidaoDados.obter(id);
  if (!prontidao.motor.liberado) throw new Error(`Motor bloqueado: ${prontidao.motor.pendencias.join(' ')}`);
  return { periodo, reconciliacao, prontidao };
}

module.exports = { preparar };

/* Reprocessamento incremental real pela fila, sem fotografia anterior válida. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-worker-reprocessa-'));
process.env.SATTVA_DADOS = dir;
const db = require('../src/db');
const fila = require('../src/services/processamentoCarteira');
const operacao = require('../src/services/operacaoCompartilhada');
const projecoes = require('../src/services/projecoesMovimentos');

(async () => {
  const originais = {
    preparar:operacao.prepararContextoMotorIncremental,
    publicar:operacao.publicarResultadosMotor,
    promover:operacao.promoverFotografiaMotorIncremental,
    validar:operacao.validarFotografiaAtivaMotor,
    estados:operacao.publicarEstadosProjecoes,
  };
  try {
    const empresaId = Number(db.prepare("INSERT INTO empresas(cnpj,razao_social,regime) VALUES ('99000000000270','Empresa de reprocessamento','lucro_real')").run().lastInsertRowid);
    db.prepare("INSERT INTO parceiros(empresa_id,tipo,cnpj,descricao,regime,regime_origem,regime_versao) VALUES (?,'fornecedor','88000000000269','Fornecedor de reprocessamento','lucro_real','TESTE',1)").run(empresaId);
    const movimentoId = Number(db.prepare(`INSERT INTO movimentos
      (empresa_id,tipo,nome,inscr_federal,descricao,ncm,valor,base_calculo,competencia,reducao,regime,regime_fonte,regime_parceiro_versao)
      VALUES (?,'fornecedor','Fornecedor de reprocessamento','88000000000269','Mercadoria', '01012100',1000,1000,'2027-01','integral','lucro_real','PARCEIRO_CANONICO',1)`).run(empresaId).lastInsertRowid);
    projecoes.marcar(db,empresaId,[movimentoId],projecoes.ESTADOS.PENDENTE,'Aguardando reprocessamento','job-reprocessa');

    // A fila é real; somente a fronteira remota é simulada para manter o teste
    // descartável e provar que o worker não precisa recalcular outra empresa.
    operacao.prepararContextoMotorIncremental = async () => ({ movimentos:1 });
    operacao.publicarResultadosMotor = async (_empresa,{ execucao_id }) => ({ empresa_remota_id:empresaId,execucao_id });
    operacao.promoverFotografiaMotorIncremental = async (_empresa,_execucao,quantidade) => ({ quantidade });
    operacao.validarFotografiaAtivaMotor = async () => ({ ok:true });
    operacao.publicarEstadosProjecoes = async () => ({ publicados:1 });

    const processamentoId = Number(db.prepare("INSERT INTO processamentos_carteira(grupo_id,tipo,status,total_empresas,iniciado_em) VALUES ('teste-reprocessa','MOTOR_INCREMENTAL','AGENDADO',1,datetime('now','localtime'))").run().lastInsertRowid);
    db.prepare(`INSERT INTO jobs_carteira
      (id,processamento_id,grupo_id,empresa_id,competencia,tipo_job,status,tentativas,max_tentativas,payload,criado_em)
      VALUES ('job-reprocessa',?,'teste-reprocessa',?,'2027','MOTOR_INCREMENTAL','PENDENTE',0,1,?,datetime('now','localtime'))`)
      .run(processamentoId,empresaId,JSON.stringify({ movimento_ids:[movimentoId],ano:2027 }));
    await fila.executar(processamentoId);

    const job = db.prepare("SELECT status,erro,payload FROM jobs_carteira WHERE id='job-reprocessa'").get();
    const estado = db.prepare('SELECT situacao FROM projecoes_movimentos_estado WHERE empresa_id=? AND movimento_id=?').get(empresaId,movimentoId);
    const quantidade = db.prepare('SELECT COUNT(*) quantidade FROM motor_resultados WHERE empresa_id=? AND movimento_id=?').get(empresaId,movimentoId).quantidade;
    assert.equal(job.status,'CONCLUIDO',job.erro);
    assert.equal(JSON.parse(job.payload).etapa,'PROMOVENDO_FOTOGRAFIA');
    assert.equal(estado.situacao,projecoes.ESTADOS.ATUAL);
    assert.equal(quantidade,1);
    console.log('worker-incremental-reprocessamento.test: fila recalcula somente o delta e promove estado ATUAL.');
  } finally {
    Object.assign(operacao, { prepararContextoMotorIncremental:originais.preparar,publicarResultadosMotor:originais.publicar,promoverFotografiaMotorIncremental:originais.promover,validarFotografiaAtivaMotor:originais.validar,publicarEstadosProjecoes:originais.estados });
    try { db.close?.(); } catch (_) { /* nada a fazer */ }
    fs.rmSync(dir,{ recursive:true,force:true });
  }
})().catch((erro) => { console.error(erro); process.exitCode=1; });

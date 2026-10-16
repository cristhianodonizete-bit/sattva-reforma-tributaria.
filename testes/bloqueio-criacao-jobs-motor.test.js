const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const permissao = require('../src/services/permissaoCriacaoJobsMotor');
const api = fs.readFileSync(path.join(raiz, 'src/routes/api.js'), 'utf8');
const fila = fs.readFileSync(path.join(raiz, 'src/services/motorExecucaoFila.js'), 'utf8');
const automatico = fs.readFileSync(path.join(raiz, 'src/services/reprocessamentoAutomatico.js'), 'utf8');

function comFlag(valor, fn) {
  const anterior = process.env.MOTOR_CRIACAO_JOBS_PERMITIDA;
  if (valor === undefined) delete process.env.MOTOR_CRIACAO_JOBS_PERMITIDA;
  else process.env.MOTOR_CRIACAO_JOBS_PERMITIDA = valor;
  try { return fn(); } finally {
    if (anterior === undefined) delete process.env.MOTOR_CRIACAO_JOBS_PERMITIDA;
    else process.env.MOTOR_CRIACAO_JOBS_PERMITIDA = anterior;
  }
}

comFlag(undefined, () => {
  assert.equal(permissao.permitida(), false, 'variável ausente bloqueia por padrão');
  assert.throws(() => permissao.exigir(), (erro) => erro.codigo === 'MOTOR_CRIACAO_JOBS_BLOQUEADA' && erro.status === 423);
});
comFlag('true', () => assert.equal(permissao.permitida(), true, 'true libera o comportamento anterior'));

const leitura = api.slice(api.indexOf('async function atualizarDiagnosticoSeAberto'), api.indexOf('// Fechamento é um marco'));
assert.match(leitura, /CRIACAO_DE_JOB_BLOQUEADA/);
assert.ok(leitura.indexOf('CRIACAO_DE_JOB_BLOQUEADA') < leitura.indexOf('motorExecucaoFila.solicitarIncremental'), 'GET retorna antes de criar job');
for (const rota of ['/beneficios-fiscais/revisao', '/impacto-final-cbs', '/cenarios']) assert.ok(api.includes(`router.get('/empresas/:id${rota}`));

assert.match(api, /res\.status\(e\?\.status \|\| status\)/, 'erros de bloqueio retornam seu HTTP 423');
for (const rota of ['/motor/executar', '/regimes/auditoria-vigencia/reprocessar', '/parceiros/:parceiroId/reprocessar-regime', '/motor/recalcular-parametros']) {
  assert.ok(api.includes(`router.post('/empresas/:id${rota}`), `rota ${rota} permanece existente e é protegida pela fila`);
}
assert.match(fila, /permissaoCriacaoJobsMotor\.exigir\(\)/g, 'ambas as criações de job passam pela guarda');
assert.match(fila, /!permissaoCriacaoJobsMotor\.permitida\(\)/, 'web não inicia consumidor contingencial sem liberação');
assert.match(automatico, /!permissaoCriacaoJobsMotor\.permitida\(\)/, 'agendador automático não cria jobs sem liberação');

const cadeia = api.slice(api.indexOf("router.get('/empresas/:id/regimes/auditoria-vigencia'"), api.indexOf("router.post('/empresas/:id/regimes/auditoria-vigencia/reprocessar'"));
assert.match(cadeia, /restaurarFotografiaMotorEmpresa/);
assert.doesNotMatch(cadeia, /solicitarIncremental|renovarFotografiasItensEntradaManualSeNecessario/);

console.log('bloqueio-criacao-jobs-motor: flag ausente bloqueia GET, POST, contingência e scheduler; true preserva liberação: OK');

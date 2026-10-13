const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const op = fs.readFileSync(path.join(__dirname, '../src/services/operacaoCompartilhada.js'), 'utf8');
const prep = fs.readFileSync(path.join(__dirname, '../src/services/preparacaoMotor.js'), 'utf8');
const fila = fs.readFileSync(path.join(__dirname, '../src/services/processamentoCarteira.js'), 'utf8');
assert.match(op, /async function prepararContextoMotorEmpresa\(empresaId\)/);
assert.match(op, /TABELAS_MOTOR_DA_EMPRESA/);
assert.match(op, /REFERENCIAS_GLOBAIS_DO_MOTOR/);
assert.match(op, /DELETE FROM regras_governo/);
assert.match(op, /if \(ativo\(\)\) \{/);
assert.match(op, /sem depender da conexão PostgreSQL direta/);
assert.match(op, /restaurarEvidenciasMotorAposDocumentos/);
assert.match(op, /gravarEmpresas\(\[empresaRemota\]\)/);
const inicioIncremental = op.indexOf('async function prepararContextoMotorIncremental');
const gravacaoEmpresaIncremental = op.indexOf('gravarEmpresas([empresaRemota]);', inicioIncremental);
const gravacaoMovimentoIncremental = op.indexOf("gravar('movimentos', movimentos);", inicioIncremental);
assert.ok(gravacaoEmpresaIncremental >= inicioIncremental && gravacaoEmpresaIncremental < gravacaoMovimentoIncremental,
  'o worker incremental deve gravar a empresa-pai antes dos movimentos com chave estrangeira');
assert.match(op, /buscarPorValores\(remoto,'parceiros','cnpj',cnpjs,empresaRemota\.id\)/,
  'fornecedores incrementais devem ser filtrados pela empresa antes de entrar no cache');
assert.match(op, /from\('empresas'\)\.select\('\*'\)/,
  'o contexto incremental deve reidratar a identidade completa da empresa para publicar estados ao final');
assert.match(op, /\.eq\('origem_local_id',Number\(empresaId\)\)/,
  'a publicação de estados deve localizar a empresa canônica mesmo sem cache local');
assert.match(prep, /await operacaoCompartilhada\.prepararContextoMotorEmpresa\(id\)/);
assert.match(prep, /await operacaoCompartilhada\.restaurarEvidenciasMotorAposDocumentos\(id\)/);
assert.ok(fila.indexOf("await require('./preparacaoMotor').preparar(job.empresa_id)") < fila.indexOf('motorStaging.criar(job.id, job.empresa_id)'), 'staging deve ser criado depois da empresa no cache do worker');
console.log('worker-contexto-empresa: worker restaura apenas a empresa e referências antes do motor.');

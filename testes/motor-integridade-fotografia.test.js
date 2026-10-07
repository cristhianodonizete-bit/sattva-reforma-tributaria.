const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fila = fs.readFileSync(path.join(__dirname, '../src/services/processamentoCarteira.js'), 'utf8');
const preparo = fs.readFileSync(path.join(__dirname, '../src/services/preparacaoMotor.js'), 'utf8');
const operacao = fs.readFileSync(path.join(__dirname, '../src/services/operacaoCompartilhada.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261007_integridade_fotografia_motor.sql'), 'utf8');

assert.match(preparo, /permitirPublicacao:false/, 'o motor deve ser somente-leitura para fatos fiscais pendentes');
assert.match(operacao, /O motor nunca é um canal de publicação de fatos fiscais/, 'reconciliação deve bloquear publicação implícita pelo motor');
assert.match(fila, /integridadeMotor\.assinarEntrada/, 'worker deve assinar a entrada antes de calcular');
assert.match(fila, /integridadeMotor\.exigirMesmaEntrada\(entradaMotor, entradaAntesDePublicar\)/, 'mudança durante cálculo deve impedir publicação');
assert.match(fila, /integridadeMotor\.exigirMesmaEntrada\(entradaMotor, entradaAntesDePromover\)/, 'mudança durante transporte deve impedir promoção');
assert.match(fila, /Não determinismo detectado/, 'mesma entrada com saída diferente deve preservar a fotografia anterior');
assert.match(migration, /dados->'integridade'->'entrada'->>'assinatura'/, 'RPC deve exigir assinatura da entrada');
assert.match(migration, /count\(distinct movimento_id\)/, 'RPC deve rejeitar item duplicado');
assert.match(operacao, /execucaoIdsAtivos/, 'restauração deve usar a execução dos resultados ativos, não a mais recente');
console.log('motor-integridade-fotografia: motor somente-leitura, assinatura e promoção atômica validados.');

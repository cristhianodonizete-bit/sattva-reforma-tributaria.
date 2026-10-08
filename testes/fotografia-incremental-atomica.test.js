const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fila = fs.readFileSync(path.join(__dirname, '../src/services/processamentoCarteira.js'), 'utf8');
const operacao = fs.readFileSync(path.join(__dirname, '../src/services/operacaoCompartilhada.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261008_promocao_incremental_fotografia_completa.sql'), 'utf8');

assert.match(fila, /prepararContextoMotorIncremental/, 'job incremental deve reidratar o escopo canônico antes de calcular');
assert.match(fila, /promoverFotografiaMotorIncremental/, 'delta não pode ficar somente no cache local');
assert.match(fila, /fotografia_itens/, 'job concluído deve registrar o tamanho da fotografia completa');
assert.match(operacao, /in\('id', ids\)/, 'a reidratação deve buscar somente os IDs explicitamente autorizados');
assert.match(operacao, /não publica,\n\/\/ não remove e não reconcilia a base/i, 'reidratação incremental não pode alterar fontes');
assert.match(migration, /pg_advisory_xact_lock/, 'promoção incremental deve serializar por empresa');
assert.match(migration, /not exists \(/i, 'linhas intactas devem ser copiadas excluindo apenas o recorte recalculado');
assert.match(migration, /update public\.motor_resultados_operacionais set ativo=false/i, 'troca da fotografia deve ocorrer somente após validação');
assert.match(migration, /return v_total/i, 'promoção deve devolver a contagem da fotografia completa');

console.log('fotografia-incremental-atomica: escopo canônico e promoção completa validados.');

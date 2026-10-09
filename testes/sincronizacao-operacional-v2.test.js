const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015_sincronizacao_operacional_v2_homologacao.sql'), 'utf8');
assert.match(sql, /sequencia_consumo bigint/);
assert.match(sql, /sincronizacao_operacional_consumidores/);
assert.match(sql, /campos_tecnicos text\[\]/);
assert.match(sql, /dados_antigos is not distinct from dados_novos/);
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /for update/);
assert.match(sql, /for update skip locked/);
assert.match(sql, /proxima_sequencia_consumo=fim \+ 1/);
assert.match(sql, /confirmar_checkpoint_sincronizacao_operacional/);
assert.match(sql, /greatest\(consumidor\.sequencia_confirmada/);
assert.doesNotMatch(sql, /delete from public\.sincronizacao_operacional_eventos/i);
assert.doesNotMatch(sql, /truncate\s+public\.sincronizacao_operacional_eventos/i);
console.log('sincronizacao-operacional-v2: supressão de ruído, fila serial e checkpoint central validados.');

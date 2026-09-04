const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260917_trilha_incremental_operacional.sql'), 'utf8');
assert.match(sql, /sincronizacao_operacional_eventos/);
assert.match(sql, /operacao in \('INSERT', 'UPDATE', 'DELETE'\)/);
assert.match(sql, /chave jsonb not null/);
assert.match(sql, /to_jsonb\(OLD\).*to_jsonb\(NEW\)/s);
assert.match(sql, /jsonb_object_agg\(a\.attname, dados -> a\.attname\)/);
assert.match(sql, /enable row level security/);
assert.match(sql, /revoke all on public\.sincronizacao_operacional_eventos from anon, authenticated/);
assert.match(sql, /after insert or update or delete/);
assert.doesNotMatch(sql, /dados jsonb not null/);
console.log('trilha-incremental-operacional: estrutura de eventos sem conteúdo sensível validada.');

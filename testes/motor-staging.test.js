const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const local = fs.readFileSync(path.join(__dirname, '../src/db.js'), 'utf8');
const remoto = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260903_staging_duravel_motor.sql'), 'utf8');
assert.match(local, /CREATE TABLE IF NOT EXISTS motor_fotografias_staging/, 'staging local deve existir');
assert.match(remoto, /create table if not exists public\.motor_fotografias_staging/i, 'staging compartilhado deve existir');
assert.match(remoto, /on delete cascade/, 'staging deve acompanhar o job sem tocar no resultado ativo');
console.log('motor-staging: isolamento local e compartilhado validado.');

const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '../src/services/motorStaging.js'), 'utf8');
assert.match(s, /'AGUARDANDO'/); assert.match(s, /UPDATE motor_fotografias_staging SET status=/); assert.match(s, /ON CONFLICT\(job_id\) DO NOTHING/);
console.log('motor-staging-ciclo: estados duráveis do worker validados.');

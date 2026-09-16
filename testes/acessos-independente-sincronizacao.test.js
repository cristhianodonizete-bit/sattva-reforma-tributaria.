const assert = require('assert');
const fs = require('fs');
const server = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');

assert.match(server, /req\.path === '\/acessos' \|\| req\.path\.startsWith\('\/acessos\/'\)/,
  'rotas de gestão de usuários precisam ser independentes da sincronização operacional');
console.log('OK: reenvio de convite não é bloqueado pela sincronização operacional.');

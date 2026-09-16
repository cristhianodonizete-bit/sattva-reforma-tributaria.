const assert = require('assert');
const fs = require('fs');
const server = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');

assert.match(server, /req\.path === '\/acessos' \|\| req\.path\.startsWith\('\/acessos\/'\)/,
  'rotas de gestão de usuários precisam ser independentes da sincronização operacional');
assert.doesNotMatch(server, /!estadoOperacao\.pronta && !\['GET', 'HEAD', 'OPTIONS'\]\.includes\(req\.method\)/,
  'uma base local existente não pode bloquear alterações enquanto uma atualização remota termina');
assert.match(server, /estadoOperacao\.pronta \|\| estadoOperacao\.possuiBaseLocal/,
  'a base local existente precisa liberar a operação');
console.log('OK: base local e gestão de acessos não são bloqueadas pela sincronização operacional.');

const assert = require('assert');
const fs = require('fs');
const server = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');

assert.match(server, /req\.path === '\/acessos' \|\| req\.path\.startsWith\('\/acessos\/'\)/,
  'rotas de gestão de usuários precisam ser independentes da sincronização operacional');
assert.doesNotMatch(server, /!estadoOperacao\.pronta && !\['GET', 'HEAD', 'OPTIONS'\]\.includes\(req\.method\)/,
  'uma base local existente não pode bloquear alterações enquanto uma atualização remota termina');
assert.match(server, /estadoOperacao\.pronta \|\| estadoOperacao\.possuiBaseLocal/,
  'a base local existente precisa liberar a operação');
assert.match(server, /return empresas > 0;/,
  'a carteira de empresas deve liberar a navegação sem aguardar movimentos e resultados do motor');
assert.doesNotMatch(server, /empresas > 0 && movimentos > 0 && resultados > 0/,
  'a sincronização de movimentos não pode congelar toda a aplicação');
console.log('OK: base local e gestão de acessos não são bloqueadas pela sincronização operacional.');

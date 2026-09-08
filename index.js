// Compatibilidade com ambientes que ainda executam `node index.js`.
// A aplicação continua centralizada em server.js; este arquivo não cria
// configuração, não altera dados e não executa nenhuma rotina adicional.
require('./server');

// Aplicação explícita da migração da outbox. Tudo ou nada: se qualquer comando
// falhar, a transação inteira é revertida e nenhuma tabela permanece criada.
const fs = require('fs');
const path = require('path');
const dbPadrao = require('../db');

const CAMINHO_SQL = path.join(__dirname, '..', '..', 'scripts', 'migracoes', 'entradas_questor_publicacao.sql');

function lerSql() { return fs.readFileSync(CAMINHO_SQL, 'utf8'); }

function aplicarMigracao(sqlTexto = lerSql(), { banco = dbPadrao } = {}) {
  return banco.transaction(() => { banco.exec(sqlTexto); return true; })();
}

module.exports = { CAMINHO_SQL, lerSql, aplicarMigracao };

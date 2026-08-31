/**
 * ACESSO AO SQLITE — sem compilação nativa
 * ---------------------------------------------------------------------------
 * Usa o módulo `node:sqlite`, embutido no próprio Node.js a partir da versão
 * 22 (estável na 24). Não exige Visual Studio, Windows SDK nem node-gyp.
 *
 * Se o `better-sqlite3` estiver instalado no ambiente, ele é usado por ser um
 * pouco mais rápido — mas é totalmente opcional.
 *
 * A interface exposta é a mesma nos dois casos:
 *   db.exec(sql) · db.prepare(sql).run/get/all(...) · db.transaction(fn)
 */
const [maior, menor] = process.versions.node.split('.').map(Number);
const MODOS_JORNAL = new Set(['WAL', 'MEMORY', 'DELETE', 'TRUNCATE', 'PERSIST', 'OFF']);
const modoJournal = () => {
  const modo = String(process.env.SATTVA_SQLITE_JOURNAL_MODE || 'WAL').toUpperCase();
  return MODOS_JORNAL.has(modo) ? modo : 'WAL';
};

function normalizar(params) {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    return v;
  });
}

function abrirComNodeSqlite(caminho) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (e) {
    throw new Error(
      `Este Node.js (v${process.versions.node}) não expõe o módulo node:sqlite.\n` +
      'Use Node.js 22 ou superior (recomendado: 24 LTS) — https://nodejs.org\n' +
      'No Node 22 pode ser necessário iniciar com: node --experimental-sqlite server.js'
    );
  }
  const raw = new DatabaseSync(caminho);
  raw.exec(`PRAGMA journal_mode = ${modoJournal()}`);
  raw.exec('PRAGMA foreign_keys = ON');

  return {
    motor: 'node:sqlite',
    exec: (sql) => raw.exec(sql),
    pragma: (p) => raw.exec(`PRAGMA ${p}`),
    prepare(sql) {
      const st = raw.prepare(sql);
      return {
        run: (...p) => {
          const r = st.run(...normalizar(p));
          return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
        },
        get: (...p) => st.get(...normalizar(p)),
        all: (...p) => st.all(...normalizar(p)),
      };
    },
    transaction(fn) {
      return (...args) => {
        raw.exec('BEGIN');
        try { const r = fn(...args); raw.exec('COMMIT'); return r; }
        catch (e) { try { raw.exec('ROLLBACK'); } catch (_) {} throw e; }
      };
    },
    close: () => raw.close(),
  };
}

function abrir(caminho) {
  try {
    const Better = require('better-sqlite3');
    const db = new Better(caminho);
    db.pragma(`journal_mode = ${modoJournal()}`);
    db.pragma('foreign_keys = ON');
    db.motor = 'better-sqlite3';
    return db;
  } catch (_) {
    if (maior < 22 || (maior === 22 && menor === undefined)) {
      throw new Error(`Node.js v${process.versions.node} é antigo demais. Instale o Node.js 22 ou superior: https://nodejs.org`);
    }
    return abrirComNodeSqlite(caminho);
  }
}

module.exports = { abrir };

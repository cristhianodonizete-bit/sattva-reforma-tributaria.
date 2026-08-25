/** Processamento controlado da carteira, por empresa e com estado persistido. */
const db = require('../db');
const bases = require('./basesReforma');
const motorExec = require('./motorExec');
const excecoesMotor = require('./excecoesMotor');

const ativos = new Set();

function iniciar(opcoes = {}) {
  const empresas = db.prepare('SELECT id FROM empresas ORDER BY id').all();
  const r = db.prepare(`INSERT INTO processamentos_carteira (tipo,status,total_empresas,iniciado_em)
    VALUES (?, 'AGENDADO', ?, datetime('now','localtime'))`).run(opcoes.tipo || 'RECALCULO', empresas.length);
  const id = Number(r.lastInsertRowid);
  const inserir = db.prepare('INSERT INTO processamentos_carteira_itens (processamento_id,empresa_id,status) VALUES (?,?,' + "'AGENDADA'" + ')');
  db.transaction(() => empresas.forEach((e) => inserir.run(id, e.id)))();
  executar(id, opcoes);
  return consultar(id);
}

function executar(id, opcoes = {}) {
  if (ativos.has(Number(id))) return;
  ativos.add(Number(id));
  db.prepare("UPDATE processamentos_carteira SET status='EXECUTANDO', iniciado_em=COALESCE(iniciado_em,datetime('now','localtime')) WHERE id=?").run(id);
  const proximo = () => {
    const item = db.prepare("SELECT * FROM processamentos_carteira_itens WHERE processamento_id=? AND status='AGENDADA' ORDER BY id LIMIT 1").get(id);
    if (!item) {
      db.prepare("UPDATE processamentos_carteira SET status='CONCLUIDO', concluido_em=datetime('now','localtime') WHERE id=?").run(id);
      ativos.delete(Number(id)); return;
    }
    try {
      db.prepare("UPDATE processamentos_carteira_itens SET status='EXECUTANDO', iniciado_em=datetime('now','localtime') WHERE id=?").run(item.id);
      bases.classificarMovimentos(item.empresa_id);
      const resultado = motorExec.executar(item.empresa_id, { ano: 2027 });
      const excecoes = excecoesMotor.resumo(item.empresa_id);
      const status = excecoes.abertas ? 'COM_EXCECOES' : resultado.resumo.simulados ? 'COM_PREMISSAS' : 'AUTOMATICA';
      db.prepare("UPDATE processamentos_carteira_itens SET status=?, motivo=?, itens_processados=?, excecoes_abertas=?, concluido_em=datetime('now','localtime') WHERE id=?")
        .run(status, status === 'COM_EXCECOES' ? 'Casos direcionados à Central de Exceções' : status === 'COM_PREMISSAS' ? 'Processado com premissas previamente aprovadas' : 'Processado automaticamente', resultado.resumo.itens, excecoes.abertas, item.id);
      const campo = status === 'COM_EXCECOES' ? 'com_excecoes' : status === 'COM_PREMISSAS' ? 'com_premissas' : 'automaticas';
      db.prepare(`UPDATE processamentos_carteira SET processadas=processadas+1, ${campo}=${campo}+1 WHERE id=?`).run(id);
    } catch (e) {
      db.prepare("UPDATE processamentos_carteira_itens SET status='BLOQUEADA', motivo=?, concluido_em=datetime('now','localtime') WHERE id=?").run(e.message, item.id);
      db.prepare('UPDATE processamentos_carteira SET processadas=processadas+1,bloqueadas=bloqueadas+1 WHERE id=?').run(id);
    }
    setImmediate(proximo);
  };
  setImmediate(proximo);
}

function consultar(id) {
  const cabecalho = db.prepare('SELECT * FROM processamentos_carteira WHERE id=?').get(id);
  if (!cabecalho) return null;
  const itens = db.prepare(`SELECT * FROM processamentos_carteira_itens WHERE processamento_id=? ORDER BY
    CASE status WHEN 'BLOQUEADA' THEN 1 WHEN 'COM_EXCECOES' THEN 2 WHEN 'EXECUTANDO' THEN 3 ELSE 4 END, id`).all(id);
  return { ...cabecalho, itens };
}

function ultimo() {
  const x = db.prepare('SELECT id FROM processamentos_carteira ORDER BY id DESC LIMIT 1').get();
  return x ? consultar(x.id) : null;
}

module.exports = { iniciar, consultar, ultimo };

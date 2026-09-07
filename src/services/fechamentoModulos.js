const db = require('../db');

const MODULOS = [
  { chave:'perfil', modulo:'diagnostico', titulo:'Módulo 1 · Perfil tributário' },
  { chave:'fornecedores', modulo:'diagnostico', titulo:'Módulo 1 · Cadeia de fornecedores' },
  { chave:'clientes', modulo:'diagnostico', titulo:'Módulo 1 · Cadeia de clientes' },
  { chave:'impacto_cbs', modulo:'diagnostico', titulo:'Módulo 1 · Impacto final CBS' },
  { chave:'cenarios', modulo:'diagnostico', titulo:'Módulo 1 · Projeção de cenários' },
  { chave:'conformidade', modulo:'diagnostico', titulo:'Módulo 1 · Conformidade documental' },
  { chave:'precificacao', modulo:'precificacao', titulo:'Módulo 2 · Precificação e margem' },
  { chave:'formacao_custo', modulo:'precificacao', titulo:'Módulo 2 · Formação de custo' },
  { chave:'contratos', modulo:'contratos', titulo:'Módulo 3 · Revisão de contratos' },
  { chave:'capacitacao', modulo:'capacitacao', titulo:'Módulo 4 · Capacitação do time' },
  { chave:'planejamento', modulo:'planejamento', titulo:'Módulo 5 · Planejamento tributário' },
  { chave:'acompanhamento', modulo:'acompanhamento', titulo:'Módulo 6 · Acompanhamento' },
];
const porChave = new Map(MODULOS.map((m) => [m.chave, m]));
const agora = () => new Date().toISOString();

function empresaExiste(empresaId) {
  const empresa = db.prepare('SELECT id FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');
}
function moduloValido(modulo) {
  const m = porChave.get(String(modulo || ''));
  if (!m) throw new Error('Módulo inválido para fechamento.');
  return m;
}
function listar(empresaId) {
  empresaExiste(empresaId);
  const estados = new Map(db.prepare('SELECT * FROM empresa_submodulos_entrega WHERE empresa_id=?').all(empresaId).map((x) => [x.submodulo, x]));
  const modulos = MODULOS.map((m) => {
    const e = estados.get(m.chave);
    return { ...m, status:e?.status || 'ABERTO', fechado_em:e?.fechado_em || null, fechado_por:e?.fechado_por || null, observacao:e?.observacao || null, reaberto_em:e?.reaberto_em || null, reaberto_por:e?.reaberto_por || null, motivo_reabertura:e?.motivo_reabertura || null };
  });
  const abertos = modulos.filter((m) => m.status !== 'FECHADO');
  return { modulos, pronto_para_entrega:abertos.length === 0, abertos:abertos.map((m) => ({ chave:m.chave, titulo:m.titulo })) };
}
function registrarEvento(empresaId, modulo, acao, usuarioId, dados) {
  db.prepare('INSERT INTO empresa_submodulos_entrega_eventos (empresa_id,submodulo,acao,usuario_id,dados_json,criado_em) VALUES (?,?,?,?,?,?)')
    .run(empresaId, modulo, acao, usuarioId || null, JSON.stringify(dados || {}), agora());
}
function fechar({ empresaId, modulo, usuarioId, observacao }) {
  empresaExiste(empresaId); moduloValido(modulo);
  const anterior = db.prepare('SELECT * FROM empresa_submodulos_entrega WHERE empresa_id=? AND submodulo=?').get(empresaId, modulo);
  if (anterior?.status === 'FECHADO') return { ...listar(empresaId), alterado:false };
  const quando = agora();
  db.transaction(() => {
    db.prepare(`INSERT INTO empresa_submodulos_entrega (empresa_id,submodulo,status,fechado_em,fechado_por,observacao,reaberto_em,reaberto_por,motivo_reabertura,atualizado_em)
      VALUES (?,?, 'FECHADO', ?,?,?,NULL,NULL,NULL,?)
      ON CONFLICT(empresa_id,submodulo) DO UPDATE SET status='FECHADO',fechado_em=excluded.fechado_em,fechado_por=excluded.fechado_por,observacao=excluded.observacao,atualizado_em=excluded.atualizado_em`).run(empresaId, modulo, quando, usuarioId || null, String(observacao || '').trim() || null, quando);
    registrarEvento(empresaId, modulo, 'FECHADO', usuarioId, { observacao:String(observacao || '').trim() || null, anterior_status:anterior?.status || 'ABERTO' });
  })();
  return { ...listar(empresaId), alterado:true };
}
function reabrir({ empresaId, modulo, usuarioId, motivo }) {
  empresaExiste(empresaId); moduloValido(modulo);
  const anterior = db.prepare('SELECT * FROM empresa_submodulos_entrega WHERE empresa_id=? AND submodulo=?').get(empresaId, modulo);
  if (!anterior || anterior.status !== 'FECHADO') throw new Error('Apenas módulos fechados podem ser reabertos.');
  const justificativa = String(motivo || '').trim();
  if (!justificativa) throw new Error('Informe o motivo da reabertura para preservar a rastreabilidade.');
  const quando = agora();
  db.transaction(() => {
    db.prepare("UPDATE empresa_submodulos_entrega SET status='ABERTO',reaberto_em=?,reaberto_por=?,motivo_reabertura=?,atualizado_em=? WHERE empresa_id=? AND submodulo=?")
      .run(quando, usuarioId || null, justificativa, quando, empresaId, modulo);
    registrarEvento(empresaId, modulo, 'REABERTO', usuarioId, { motivo:justificativa, fechamento_anterior:anterior.fechado_em || null });
  })();
  return { ...listar(empresaId), alterado:true };
}
function exigirProntoParaEntrega(empresaId) {
  const estado = listar(empresaId);
  if (!estado.pronto_para_entrega) throw new Error(`Entregável bloqueado: feche os módulos pendentes antes de gerar a apresentação (${estado.abertos.map((m) => m.titulo).join(', ')}).`);
  return estado;
}

function exigirAberto(empresaId, modulo, acao = 'executar um novo cálculo') {
  const estado = listar(empresaId);
  const atual = estado.modulos.find((m) => m.chave === modulo);
  if (atual?.status === 'FECHADO') throw new Error(`${atual.titulo} está fechado. Reabra o módulo antes de ${acao}.`);
  return estado;
}

module.exports = { MODULOS, listar, fechar, reabrir, exigirProntoParaEntrega, exigirAberto };

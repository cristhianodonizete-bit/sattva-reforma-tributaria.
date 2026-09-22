const db = require('../db');
const supabase = require('./supabase');

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
function compartilhadoAtivo() {
  return supabase.configurado() && process.env.SUPABASE_OPERACAO_COMPARTILHADA !== 'false';
}
async function empresaRemota(empresaId) {
  const empresa = db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para sincronizar o fechamento.');
  const cnpj = String(empresa.cnpj).replace(/\D/g, '');
  const remoto = supabase.admin();
  const { data, error } = await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`).limit(10);
  if (error) throw new Error(`Empresa compartilhada: ${error.message}`);
  const candidatas = (data || []).filter((linha) => Number(linha.origem_local_id) === Number(empresaId)
    || String(linha.cnpj || '').replace(/\D/g, '') === cnpj);
  if (candidatas.length !== 1) throw new Error('Empresa compartilhada não localizada de forma única; o fechamento local foi preservado.');
  return { remoto, empresaRemotaId:Number(candidatas[0].id) };
}

// O fechamento é um dado de governança. Diferentemente de uma preferência de
// tela, ele precisa ter uma única fonte de verdade para não reaparecer aberto
// após atualização, troca de máquina ou reconstrução do cache local.
async function sincronizarCompartilhado(empresaId) {
  empresaExiste(empresaId);
  if (!compartilhadoAtivo()) return { ativo:false, sincronizados:0 };
  const { remoto, empresaRemotaId } = await empresaRemota(empresaId);
  const { data, error } = await remoto.from('empresa_submodulos_entrega').select('*').eq('empresa_id', empresaRemotaId);
  if (error) throw new Error(`Fechamentos compartilhados: ${error.message}`);
  const linhas = (data || []).filter((linha) => porChave.has(linha.submodulo));
  db.transaction(() => {
    // A origem compartilhada é canônica: remover estados locais que não estão
    // nela evita que um cache antigo reverta uma reabertura válida.
    db.prepare('DELETE FROM empresa_submodulos_entrega WHERE empresa_id=?').run(empresaId);
    const inserir = db.prepare(`INSERT INTO empresa_submodulos_entrega
      (empresa_id,submodulo,status,fechado_em,fechado_por,observacao,reaberto_em,reaberto_por,motivo_reabertura,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    linhas.forEach((linha) => inserir.run(empresaId, linha.submodulo, linha.status, linha.fechado_em, linha.fechado_por,
      linha.observacao, linha.reaberto_em, linha.reaberto_por, linha.motivo_reabertura, linha.atualizado_em));
  })();
  return { ativo:true, empresa_remota_id:empresaRemotaId, sincronizados:linhas.length };
}

async function publicarCompartilhado(empresaId, evento = null) {
  empresaExiste(empresaId);
  if (!compartilhadoAtivo()) return { ativo:false };
  const { remoto, empresaRemotaId } = await empresaRemota(empresaId);
  const estados = db.prepare(`SELECT submodulo,status,fechado_em,fechado_por,observacao,reaberto_em,reaberto_por,motivo_reabertura,atualizado_em
    FROM empresa_submodulos_entrega WHERE empresa_id=?`).all(empresaId)
    .map((linha) => ({ ...linha, empresa_id:empresaRemotaId }));
  if (estados.length) {
    const { error } = await remoto.from('empresa_submodulos_entrega').upsert(estados, { onConflict:'empresa_id,submodulo' });
    if (error) throw new Error(`Persistência compartilhada do fechamento: ${error.message}`);
  }
  if (evento) {
    const { error } = await remoto.from('empresa_submodulos_entrega_eventos').insert({
      empresa_id:empresaRemotaId, submodulo:evento.modulo, acao:evento.acao, usuario_id:evento.usuarioId || null,
      dados_json:evento.dados || {}, criado_em:evento.criado_em || agora(),
    });
    if (error) throw new Error(`Histórico compartilhado do fechamento: ${error.message}`);
  }
  return { ativo:true, empresa_remota_id:empresaRemotaId, estados:estados.length };
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

module.exports = { MODULOS, listar, fechar, reabrir, sincronizarCompartilhado, publicarCompartilhado, exigirProntoParaEntrega, exigirAberto };

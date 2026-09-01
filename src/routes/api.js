const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const XLSX = require('xlsx');
const db = require('../db');
const P = require('../config/parametros');
const { CLAUSULAS, TRILHAS } = require('../config/conteudo');
const calc = require('../engine/calculadora');
const prec = require('../engine/precificacao');
const precificacaoIndependente = require('../services/precificacaoIndependente');
const precificacaoExecutiva = require('../services/precificacaoExecutiva');
const acompanhamentoExecutivo = require('../services/acompanhamentoExecutivo');
const contratosEntrega1 = require('../services/contratosEntrega1');
const contratosEntrega2 = require('../services/contratosEntrega2');
const contratosExecutivo = require('../services/contratosExecutivo');
const { analisarCadeia } = require('../engine/cadeia');
const consolidacaoOficial = require('../services/consolidacaoOficial');
const imp = require('../services/importador');
const questor = require('../services/questor');
const ia = require('../services/ia');
const rag = require('../services/rag');
const bases = require('../services/basesReforma');
const motor = require('../engine/motor');
const motorExec = require('../services/motorExec');
const xml = require('../services/importadorXml');
const sped = require('../services/importadorSped');
const mapaRiscos = require('../services/mapaRiscos');
const regras = require('../services/regras');
const dimensoes = require('../services/dimensoes');
const cenarioMotor = require('../services/cenarioMotor');
const cenarioMemoria = require('../services/cenarioMemoria');
const cenarioTemplates = require('../services/cenarioTemplates');
const analiseCadeia = require('../services/analiseCadeia');
const saidaExecutiva = require('../services/saidaExecutiva');
const cnpjReceita = require('../services/cnpjReceita');
const baseRegime = require('../services/baseRegimeReceita');
const relatorio = require('../services/relatorio');
const perfilCbs = require('../services/perfilCbs');
const excecoesMotor = require('../services/excecoesMotor');
const autonomiaTelemetry = require('../services/autonomiaTelemetry');
const coberturaDiagnostico = require('../services/coberturaDiagnostico');
const processamentoCarteira = require('../services/processamentoCarteira');
const supabase = require('../services/supabase');
const { executar: sincronizarGestaoSupabase, excluirEmpresa: excluirEmpresaSupabase } = require('../../scripts/sincronizar_gestao_supabase');
const implantacaoEscopo = require('../services/implantacaoEscopo');
const dadosAdicionaisAnalise = require('../services/dadosAdicionaisAnalise');
const perfilTributarioHistorico = require('../services/perfilTributarioHistorico');
const comparadorRegimes = require('../services/comparadorRegimes');
const apuracoesPisCofinsIa = require('../services/apuracoesPisCofinsIa');
const azureDocumentIntelligence = require('../services/azureDocumentIntelligence');

const router = express.Router();
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Os manuais são a fonte publicada no próprio repositório. A tela sempre os
// lê no momento da consulta, evitando uma cópia paralela ou desatualizada.
const DOCUMENTOS_USO = {
  manual_usuario: { titulo: 'Manual do Usuário', arquivo: 'MANUAL_USUARIO_SATTVA_REFORMA_TRIBUTARIA.md', download: 'manual-usuario-sattva-reforma-tributaria.md' },
  guia_instrutor: { titulo: 'Guia do Instrutor', arquivo: 'GUIA_INSTRUTOR_SATTVA_REFORMA_TRIBUTARIA.md', download: 'guia-instrutor-sattva-reforma-tributaria.md' },
};
const documentoUso = (tipo) => {
  const documento = DOCUMENTOS_USO[tipo];
  if (!documento) throw new Error('Documento de uso não encontrado.');
  const caminho = path.resolve(__dirname, '..', '..', 'docs', documento.arquivo);
  if (!fs.existsSync(caminho)) throw new Error('Documento de uso ainda não está disponível nesta versão publicada.');
  return { ...documento, caminho };
};
const metadadosDocumentoUso = (tipo) => {
  const documento = documentoUso(tipo);
  return { tipo, titulo: documento.titulo, arquivo: documento.arquivo, atualizado_em: fs.statSync(documento.caminho).mtime.toISOString() };
};

// Toda rota que calcula parte da fonte compartilhada. Assim, uma instância nova
// do Render nunca decide com um SQLite vazio ou com cache anterior à alteração.
async function atualizarConfiguracaoDeCalculo() {
  if (!supabase.configurado()) return;
  await require('../services/operacaoCompartilhada').baixarConfiguracao([
    'param_regimes', 'param_aliquotas', 'param_regras', 'param_reducoes', 'param_simples', 'param_tributos', 'param_cfop',
  ]);
  regras.invalidar();
}
router.get('/cnpj/:cnpj/governo', async (req, res) => { try { const d = await cnpjReceita.consultar(req.params.cnpj); ok(res, { resultado: cnpjReceita.classificarEnteGovernamental(d, String(req.params.cnpj).replace(/\D/g, '')) }); } catch (e) { erro(res, e); } });
// Cadastro central: não pertence a uma empresa específica. Os vínculos de
// cliente/fornecedor continuam em `parceiros`, isolados por empresa.
router.get('/cadastros-cnpj', async (req, res) => {
  try {
    if (!supabase.configurado()) throw new Error('Base compartilhada não configurada.');
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const tamanho = Math.min(100, Math.max(10, Number(req.query.tamanho) || 25));
    const busca = String(req.query.busca || '').replace(/[^\w\s.\-\/]/g, '').trim();
    let consulta = supabase.admin().from('cadastros_cnpj')
      .select('cnpj,razao_social,situacao,porte,uf,municipio,regime_derivado,natureza_juridica,codigo_natureza_juridica,efr,fonte,consultado_em', { count: 'exact' })
      .order('consultado_em', { ascending: false });
    if (busca) consulta = consulta.or(`cnpj.ilike.%${busca}%,razao_social.ilike.%${busca}%`);
    const { data, error, count } = await consulta.range((pagina - 1) * tamanho, pagina * tamanho - 1);
    if (error) throw error;
    // A tela não usa o regime copiado do cadastro operacional. Ela consulta a
    // mesma RFB compartilhada usada pelo motor, para não haver duas verdades.
    const rfb = await baseRegime.consultarCompartilhada((data || []).map((x) => x.cnpj), 2024);
    const cadastros = (data || []).map((x) => {
      const cnpj = String(x.cnpj || '').replace(/\D/g, '');
      const r = rfb.get(cnpj) || rfb.get(cnpj.slice(0, 8));
      return { ...x, regime_derivado: r?.regime || null,
        fonte_regime: r ? `RFB ${r.ano}` : 'Sem correspondência na RFB 2024' };
    });
    ok(res, { cadastros, total: count || 0, pagina, tamanho });
  } catch (e) { erro(res, e); }
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const uploadBaseRegime = multer({
  dest: os.tmpdir(), limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /\.(csv|txt)$/i.test(file.originalname)),
});

// As alterações feitas nas telas passam a ser publicadas na fonte compartilhada.
// A resposta não espera a rede: em caso de falha, o SQLite preserva o trabalho
// e a próxima alteração/tentativa volta a sincronizar tudo.
router.use((req, res, next) => {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  const responder = res.json.bind(res);
  res.json = (corpo) => {
    if (corpo?.ok) {
      try { require('../services/operacaoCompartilhada').publicar()
        .catch((e) => console.error('[supabase] publicação operacional:', e.message)); } catch (_) { /* opcional */ }
    }
    return responder(corpo);
  };
  next();
});

const ok = (res, dados) => res.json({ ok: true, ...dados });
const erro = (res, e, status = 400) => res.status(status).json({ ok: false, erro: e.message || String(e) });
const sincronizarGestao = () => sincronizarGestaoSupabase().catch((e) => console.error('[supabase] sincronização de gestão:', e.message));
const auditar = (req, { empresaId, acao, entidade, entidadeId, antes = null, depois = null }) => {
  if (!req.usuario?.id || !supabase.configurado()) return;
  supabase.admin().from('auditoria').insert({ empresa_id: empresaId || null, usuario_id: req.usuario.id, acao, entidade, entidade_id: String(entidadeId || ''), antes, depois })
    .then(({ error }) => { if (error) console.error('[supabase] auditoria:', error.message); })
    .catch((e) => console.error('[supabase] auditoria:', e.message));
};
const areaDaTarefaModulo = (chave) => ({
  diagnostico: 'diagnostico', precificacao: 'precificacao', contratos: 'contratos', capacitacao: 'capacitacao',
  treinamento_boas_praticas: 'capacitacao', capacitacao_operacional: 'capacitacao',
}[chave] || 'gestao_projetos');
const chaveAcessoApi = (caminho, metodo) => {
  if (/^\/operacao/.test(caminho)) return 'visao_geral';
  if (/^\/acessos/.test(caminho)) return 'acessos';
  if (/^\/grupos-empresas/.test(caminho)) return 'gestao_projetos';
  if (/^\/empresas\/\d+\/turmas/.test(caminho) || /^\/(turmas|participantes)/.test(caminho)) return 'capacitacao';
  if (/^\/empresas\/\d+\/contratos/.test(caminho) || /^\/contratos/.test(caminho)) return 'contratos';
  if (/^\/empresas\/\d+\/acompanhamento/.test(caminho) || /^\/acompanhamento/.test(caminho)) return 'gestao_projetos';
  if (/^\/empresas\/\d+\/formacao-custo/.test(caminho) || /^\/formacao-custo/.test(caminho)) return 'precificacao';
  const tarefaDoModulo = caminho.match(/^\/empresas\/\d+\/projeto\/tarefas\/([^/]+)$/);
  if (tarefaDoModulo) return areaDaTarefaModulo(tarefaDoModulo[1]);
  const responsavelDoModulo = caminho.match(/^\/empresas\/\d+\/projeto\/responsaveis\/([^/]+)$/);
  if (responsavelDoModulo) return areaDaTarefaModulo(responsavelDoModulo[1]);
  // A edição identifica o módulo pela entrega vinculada, dentro da própria rota.
  if (/^\/projeto\/tarefas\/\d+$/.test(caminho)) return null;
  if (/^\/empresas\/\d+\/acoes/.test(caminho) || /^\/acoes/.test(caminho)) return 'gestao_projetos';
  if (/^\/empresas/.test(caminho)) return metodo === 'GET' ? 'visao_geral' : 'diagnostico';
  if (/^\/(contratacoes|projeto|servicos|combos|gestao)/.test(caminho)) return 'gestao_projetos';
  if (/^\/(config|regras|questor|conhecimento|rag|ia|documentacao-uso)/.test(caminho)) return 'configuracoes';
  if (/^\/precificacao/.test(caminho)) return 'precificacao';
  if (/^\/contratos/.test(caminho)) return 'contratos';
  if (/^\/capacitacao/.test(caminho)) return 'capacitacao';
  if (/^\/(lotes|movimentos|motor|cenarios|bases|perfil|fornecedores|clientes|import)/.test(caminho)) return 'diagnostico';
  return null;
};
router.use((req, res, next) => {
  const chave = chaveAcessoApi(req.path, req.method);
  const permissoes = req.usuario?.permissoes;
  if (!chave || !permissoes) return next(); // usuários antigos continuam operando até receberem um perfil
  const acao = req.method === 'GET' ? 'ver' : 'executar';
  if (permissoes[chave]?.[acao]) return next();
  return res.status(403).json({ ok: false, erro: `Seu perfil não pode ${acao === 'ver' ? 'acessar' : 'executar ações em'} esta área.` });
});

// DOCUMENTAÇÃO DE USO — arquivos oficiais, visualização e download.
router.get('/documentacao-uso', (_req, res) => {
  try { ok(res, { documentos: Object.keys(DOCUMENTOS_USO).map(metadadosDocumentoUso) }); }
  catch (e) { erro(res, e, 404); }
});
router.get('/documentacao-uso/:tipo/download', (req, res) => {
  try {
    const documento = documentoUso(req.params.tipo);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${documento.download}"`);
    res.send(fs.readFileSync(documento.caminho, 'utf8'));
  } catch (e) { erro(res, e, 404); }
});
router.get('/documentacao-uso/:tipo', (req, res) => {
  try {
    const documento = documentoUso(req.params.tipo);
    ok(res, { documento: { ...metadadosDocumentoUso(req.params.tipo), conteudo: fs.readFileSync(documento.caminho, 'utf8') } });
  } catch (e) { erro(res, e, 404); }
});

async function empresasPermitidasUsuario(usuario) {
  if (!usuario || ['administrador', 'gestor'].includes(usuario.papel)) return null;
  const { data, error } = await supabase.admin().from('empresas_usuarios').select('empresa_id').eq('usuario_id', usuario.id);
  if (error) throw error;
  return new Set((data || []).map((x) => String(x.empresa_id)));
}
async function garantirEmpresaPermitida(req, empresaId) {
  const permitidas = await empresasPermitidasUsuario(req.usuario);
  if (permitidas !== null && !permitidas.has(String(empresaId))) throw new Error('Seu usuário não está vinculado a esta empresa.');
}
async function contratacaoPermitida(req, contratacaoId) {
  const contratacao = db.prepare('SELECT * FROM contratacoes WHERE id=?').get(contratacaoId);
  if (!contratacao) throw new Error('Projeto não encontrado.');
  await garantirEmpresaPermitida(req, contratacao.empresa_id);
  return contratacao;
}
async function contratoPermitido(req, contratoId) {
  const contrato = db.prepare('SELECT * FROM contratos WHERE id=?').get(contratoId);
  if (!contrato) throw new Error('Contrato não encontrado.');
  await garantirEmpresaPermitida(req, contrato.empresa_id);
  return contrato;
}
async function acaoPermitida(req, acaoId) {
  const acao = db.prepare('SELECT * FROM acoes WHERE id=?').get(acaoId);
  if (!acao) throw new Error('Ação não encontrada.');
  await garantirEmpresaPermitida(req, acao.empresa_id);
  return acao;
}
async function turmaPermitida(req, turmaId) {
  const turma = db.prepare('SELECT * FROM turmas WHERE id=?').get(turmaId);
  if (!turma) throw new Error('Turma não encontrada.');
  if (turma.trilha !== 'workshop_boas_praticas') { await garantirEmpresaPermitida(req, turma.empresa_id); return turma; }
  const permitidas = await empresasPermitidasUsuario(req.usuario);
  if (permitidas === null || permitidas.has(String(turma.empresa_id))) return turma;
  const vinculadas = db.prepare('SELECT DISTINCT empresa_id FROM participantes WHERE turma_id=? AND empresa_id IS NOT NULL').all(turmaId).map((x) => String(x.empresa_id));
  if (!vinculadas.some((id) => permitidas.has(id))) throw new Error('Seu usuário não está vinculado a uma empresa participante desta turma.');
  return turma;
}
async function participantePermitido(req, participanteId) {
  const participante = db.prepare(`SELECT p.*, t.empresa_id FROM participantes p JOIN turmas t ON t.id=p.turma_id WHERE p.id=?`).get(participanteId);
  if (!participante) throw new Error('Participante não encontrado.');
  await garantirEmpresaPermitida(req, participante.empresa_id);
  return participante;
}
router.use(async (req, res, next) => {
  const alvo = req.path.match(/^\/empresas\/(\d+)(?:\/|$)/)?.[1];
  if (!alvo) return next();
  try {
    const permitidas = await empresasPermitidasUsuario(req.usuario);
    if (permitidas === null || permitidas.has(String(alvo))) return next();
    return res.status(403).json({ ok: false, erro: 'Seu usuário não está vinculado a esta empresa.' });
  } catch (e) { return erro(res, e, 500); }
});

// ===========================================================================
// OPERAÇÃO COMPARTILHADA — dashboard lido da base Supabase
// ===========================================================================
router.get('/operacao/dashboard', async (req, res) => {
  try {
    const remoto = supabase.admin();
    const [{ data: empresas, error: erroEmpresas }, { data: projetos, error: erroProjetos }, { data: entregas, error: erroEntregas }, { data: acompanhamentos, error: erroAcomp }, { data: responsaveis, error: erroResponsaveis }, { data: tarefas, error: erroTarefas }] = await Promise.all([
      remoto.from('empresas').select('id,razao_social,ativo'), remoto.from('projetos').select('*'),
      remoto.from('projeto_entregas').select('*'), remoto.from('projeto_acompanhamentos').select('*'),
      remoto.from('projeto_responsaveis').select('*'),
      remoto.from('projeto_tarefas').select('*'),
    ]);
    for (const e of [erroEmpresas, erroProjetos, erroEntregas, erroAcomp, erroResponsaveis, erroTarefas]) if (e) throw e;
    const permitidas = await empresasPermitidasUsuario(req.usuario);
    const empresasVisiveis = permitidas === null ? empresas : empresas.filter((e) => permitidas.has(String(e.id)));
    const empresaPorId = new Map(empresasVisiveis.map((e) => [e.id, e]));
    const entregaPorId = new Map((entregas || []).map((e) => [e.id, e]));
    const porProjeto = new Map((entregas || []).reduce((m, x) => { const a = m.get(x.projeto_id) || []; a.push(x); m.set(x.projeto_id, a); return m; }, new Map()));
    const acompPorProjeto = new Map((acompanhamentos || []).reduce((m, x) => { const a = m.get(x.projeto_id) || []; a.push(x); m.set(x.projeto_id, a); return m; }, new Map()));
    const responsaveisPorProjeto = new Map((responsaveis || []).reduce((m, x) => { const a = m.get(x.projeto_id) || []; a.push(x); m.set(x.projeto_id, a); return m; }, new Map()));
    const tarefasPorProjeto = new Map((tarefas || []).reduce((m, x) => { const a = m.get(x.projeto_id) || []; a.push(x); m.set(x.projeto_id, a); return m; }, new Map()));
    const responsavelDaEntrega = (projetoId, entregaId, lado = 'sattva') => {
      const lista = responsaveisPorProjeto.get(projetoId) || [];
      return lista.find((x) => x.lado === lado && x.entrega_id === entregaId)?.nome || lista.find((x) => x.lado === lado && !x.entrega_id)?.nome || lista.find((x) => x.lado === lado)?.nome || null;
    };
    const hoje = new Date().toISOString().slice(0, 10);
    const carteira = (projetos || []).filter((p) => empresaPorId.has(p.empresa_id)).map((p) => {
      const es = porProjeto.get(p.id) || [], as = acompPorProjeto.get(p.id) || [], ts = tarefasPorProjeto.get(p.id) || [], rs = responsaveisPorProjeto.get(p.id) || [];
      const feitas = es.filter((x) => ['concluida', 'nao_aplicavel'].includes(x.status)).length;
      const proximaTarefa = ts.filter((x) => x.status !== 'concluida' && x.data_conclusao).sort((a, b) => String(a.data_conclusao).localeCompare(String(b.data_conclusao)))[0];
      const proximoAcompanhamento = as.filter((x) => x.status !== 'concluido').sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)))[0]?.competencia || null;
      const responsavelSattva = rs.find((x) => x.lado === 'sattva')?.nome || null;
      const pendenciasCliente = ts.filter((x) => x.status !== 'concluida' && x.envolve_cliente && String(x.pendencia_cliente || '').trim()).length;
      return { ...p, empresa: empresaPorId.get(p.empresa_id)?.razao_social || 'Cliente não identificado', entregas: es.length,
        entregasConcluidas: feitas, progresso: es.length ? Math.round((feitas / es.length) * 100) : 0,
        acompanhamentos: as.length, acompanhamentosConcluidos: as.filter((x) => x.status === 'concluido').length,
        responsavelSattva, pendenciasCliente,
        proximoAcompanhamento, proximoMarco: proximaTarefa ? { titulo: proximaTarefa.titulo, data: proximaTarefa.data_conclusao, atrasado: proximaTarefa.data_conclusao < hoje, envolveCliente: Boolean(proximaTarefa.envolve_cliente), pendenciaCliente: proximaTarefa.pendencia_cliente || '' } : null };
    }).sort((a, b) => {
      const dataA = a.proximoMarco?.data || a.proximoAcompanhamento || '9999-99';
      const dataB = b.proximoMarco?.data || b.proximoAcompanhamento || '9999-99';
      return String(dataA).localeCompare(String(dataB));
    });
    const projetoPorId = new Map(carteira.map((p) => [p.id, p]));
    const agenda = [
      ...(tarefas || []).filter((t) => projetoPorId.has(t.projeto_id) && t.status !== 'concluida' && t.data_conclusao).map((t) => {
        const p = projetoPorId.get(t.projeto_id), entrega = entregaPorId.get(t.entrega_id);
        return { tipo: 'tarefa', id: t.origem_local_id || null, projetoId: t.projeto_id, empresaId: p?.empresa_id, empresa: p?.empresa || 'Cliente não identificado', projetoStatus: p?.status || '', responsavelSattva: responsavelDaEntrega(t.projeto_id, t.entrega_id) || p?.responsavelSattva || null, responsavelCliente: responsavelDaEntrega(t.projeto_id, t.entrega_id, 'cliente'), pendenciasCliente: p?.pendenciasCliente || 0, titulo: t.titulo, etapa: entrega?.titulo || null, modulo: areaDaTarefaModulo(entrega?.chave), descricao: t.descricao || '', status: t.status || 'aberta', dataAbertura: t.data_abertura || null, data: t.data_conclusao, atrasado: t.data_conclusao < hoje, envolveCliente: Boolean(t.envolve_cliente), pendenciaCliente: t.pendencia_cliente || '', interacoesCliente: t.interacoes_cliente || '' };
      }),
      ...(acompanhamentos || []).filter((a) => projetoPorId.has(a.projeto_id) && a.status !== 'concluido' && a.competencia).map((a) => {
        const p = projetoPorId.get(a.projeto_id);
        return { tipo: 'acompanhamento', projetoId: a.projeto_id, empresaId: p?.empresa_id, empresa: p?.empresa || 'Cliente não identificado', projetoStatus: p?.status || '', responsavelSattva: p?.responsavelSattva || null, responsavelCliente: responsavelDaEntrega(a.projeto_id, null, 'cliente'), pendenciasCliente: p?.pendenciasCliente || 0, titulo: 'Acompanhamento previsto', etapa: null, data: a.competencia, atrasado: a.competencia < hoje.slice(0, 7), envolveCliente: false };
      }),
    ].sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const nomesResponsaveis = [...new Set([...carteira.map((p) => p.responsavelSattva), ...agenda.map((m) => m.responsavelSattva)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const cargaResponsaveis = nomesResponsaveis.map((nome) => ({
      nome,
      projetos: carteira.filter((p) => p.status !== 'concluido' && p.responsavelSattva === nome).length,
      pendenciasCliente: carteira.filter((p) => p.responsavelSattva === nome).reduce((n, p) => n + p.pendenciasCliente, 0),
      tarefasAtrasadas: agenda.filter((m) => m.tipo === 'tarefa' && m.atrasado && m.responsavelSattva === nome).length,
    }));
    ok(res, { empresas: empresasVisiveis.length, projetos: carteira, agenda, resumo: { emExecucao: carteira.filter((p) => p.status === 'em_execucao').length,
      aguardando: carteira.filter((p) => p.status === 'aguardando_aprovacao').length,
      entregasPendentes: carteira.reduce((n, p) => n + p.entregas - p.entregasConcluidas, 0),
      tarefasAtrasadas: agenda.filter((m) => m.tipo === 'tarefa' && m.atrasado).length,
      pendenciasCliente: carteira.reduce((n, p) => n + p.pendenciasCliente, 0),
      projetosSemResponsavel: carteira.filter((p) => p.status !== 'concluido' && !p.responsavelSattva).length }, cargaResponsaveis });
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// ACESSOS — perfis configuráveis e vínculo de usuários
// ===========================================================================
const AREAS_ACESSO = ['visao_geral', 'diagnostico', 'precificacao', 'contratos', 'capacitacao', 'gestao_projetos', 'configuracoes', 'acessos'];
function normalizarPermissoes(permissoes) {
  const origem = permissoes && typeof permissoes === 'object' ? permissoes : {};
  return Object.fromEntries(AREAS_ACESSO.map((chave) => [chave, { ver: Boolean(origem[chave]?.ver), executar: Boolean(origem[chave]?.executar) }]));
}
router.get('/acessos', async (_req, res) => {
  try {
    const remoto = supabase.admin();
    const [{ data: perfis, error: erroPerfis }, { data: usuariosPerfil, error: erroUsuariosPerfil }, { data: empresas, error: erroEmpresas }, { data: vinculos, error: erroVinculos }, usuariosAuth] = await Promise.all([
      remoto.from('perfis_acesso').select('*').order('nome'), remoto.from('perfis').select('id,nome,papel,ativo,perfil_acesso_id'), remoto.from('empresas').select('id,razao_social').order('razao_social'), remoto.from('empresas_usuarios').select('empresa_id,usuario_id,papel'), remoto.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (erroPerfis) throw erroPerfis;
    if (erroUsuariosPerfil) throw erroUsuariosPerfil;
    if (erroEmpresas) throw erroEmpresas;
    if (erroVinculos) throw erroVinculos;
    if (usuariosAuth.error) throw usuariosAuth.error;
    const perfilPorUsuario = new Map((usuariosPerfil || []).map((x) => [x.id, x]));
    const usuarios = (usuariosAuth.data.users || []).map((u) => ({ id: u.id, email: u.email, criado_em: u.created_at, ultimo_acesso: u.last_sign_in_at, ...(perfilPorUsuario.get(u.id) || { nome: '', papel: 'consultor', ativo: true, perfil_acesso_id: null }) }));
    ok(res, { areas: AREAS_ACESSO, perfis: perfis || [], usuarios, empresas: empresas || [], vinculos: vinculos || [] });
  } catch (e) { erro(res, e); }
});
router.get('/acessos/auditoria', async (_req, res) => {
  try {
    const remoto = supabase.admin();
    const [{ data: registros, error: erroRegistros }, { data: usuarios, error: erroUsuarios }] = await Promise.all([
      remoto.from('auditoria').select('id,usuario_id,acao,entidade,entidade_id,antes,depois,criado_em').order('criado_em', { ascending: false }).limit(150),
      remoto.from('perfis').select('id,nome'),
    ]);
    if (erroRegistros) throw erroRegistros;
    if (erroUsuarios) throw erroUsuarios;
    const nomes = new Map((usuarios || []).map((usuario) => [usuario.id, usuario.nome]));
    ok(res, { registros: (registros || []).map((r) => ({ ...r, usuario: nomes.get(r.usuario_id) || 'Usuário não identificado' })) });
  } catch (e) { erro(res, e); }
});
router.post('/acessos/perfis', async (req, res) => {
  try {
    const b = req.body, remoto = supabase.admin();
    if (!String(b.nome || '').trim()) throw new Error('Informe o nome do perfil.');
    const { data, error } = await remoto.from('perfis_acesso').insert({ nome: b.nome.trim(), descricao: b.descricao || '', ativo: b.ativo !== false, permissoes: normalizarPermissoes(b.permissoes) }).select().single();
    if (error) throw error;
    auditar(req, { acao: 'Criou perfil de acesso', entidade: 'perfil_acesso', entidadeId: data.id, depois: { nome: data.nome } });
    ok(res, { perfil: data });
  } catch (e) { erro(res, e); }
});
router.put('/acessos/perfis/:id', async (req, res) => {
  try {
    const b = req.body, remoto = supabase.admin();
    const { data: antes, error: erroAntes } = await remoto.from('perfis_acesso').select('*').eq('id', req.params.id).single();
    if (erroAntes) throw erroAntes;
    const { data, error } = await remoto.from('perfis_acesso').update({ nome: String(b.nome || antes.nome).trim(), descricao: b.descricao ?? antes.descricao, ativo: b.ativo !== false, permissoes: normalizarPermissoes(b.permissoes ?? antes.permissoes), atualizado_em: new Date().toISOString() }).eq('id', req.params.id).select().single();
    if (error) throw error;
    auditar(req, { acao: 'Atualizou perfil de acesso', entidade: 'perfil_acesso', entidadeId: data.id, antes: { nome: antes.nome }, depois: { nome: data.nome } });
    ok(res, { perfil: data });
  } catch (e) { erro(res, e); }
});
router.post('/acessos/usuarios', async (req, res) => {
  try {
    const b = req.body, remoto = supabase.admin(), email = String(b.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new Error('Informe um e-mail válido.');
    const { data: criado, error: erroCriar } = await remoto.auth.admin.inviteUserByEmail(email, { redirectTo: process.env.APP_URL || 'https://sattva-reforma-tributaria.onrender.com' });
    if (erroCriar) throw erroCriar;
    const { error } = await remoto.from('perfis').upsert({ id: criado.user.id, nome: String(b.nome || '').trim(), papel: 'consultor', ativo: true, perfil_acesso_id: b.perfil_acesso_id || null });
    if (error) throw error;
    const empresas = Array.isArray(b.empresa_ids) ? b.empresa_ids.filter(Boolean).map((empresa_id) => ({ empresa_id, usuario_id: criado.user.id, papel: 'consultor' })) : [];
    if (empresas.length) { const { error: erroVinculos } = await remoto.from('empresas_usuarios').upsert(empresas); if (erroVinculos) throw erroVinculos; }
    auditar(req, { acao: 'Criou usuário', entidade: 'usuario', entidadeId: criado.user.id, depois: { email, perfil_acesso_id: b.perfil_acesso_id || null } });
    ok(res, { usuario: { id: criado.user.id, email } });
  } catch (e) { erro(res, e); }
});
router.put('/acessos/usuarios/:id', async (req, res) => {
  try {
    const b = req.body, remoto = supabase.admin();
    const { data: antes, error: erroAntes } = await remoto.from('perfis').select('*').eq('id', req.params.id).maybeSingle();
    if (erroAntes) throw erroAntes;
    const { error } = await remoto.from('perfis').upsert({ id: req.params.id, nome: String(b.nome ?? antes?.nome ?? '').trim(), papel: antes?.papel || 'consultor', ativo: b.ativo !== false, perfil_acesso_id: b.perfil_acesso_id || null, atualizado_em: new Date().toISOString() });
    if (error) throw error;
    if (Array.isArray(b.empresa_ids)) {
      const { error: erroRemover } = await remoto.from('empresas_usuarios').delete().eq('usuario_id', req.params.id);
      if (erroRemover) throw erroRemover;
      const empresas = b.empresa_ids.filter(Boolean).map((empresa_id) => ({ empresa_id, usuario_id: req.params.id, papel: 'consultor' }));
      if (empresas.length) { const { error: erroVinculos } = await remoto.from('empresas_usuarios').upsert(empresas); if (erroVinculos) throw erroVinculos; }
    }
    auditar(req, { acao: 'Atualizou usuário', entidade: 'usuario', entidadeId: req.params.id, antes: { perfil_acesso_id: antes?.perfil_acesso_id || null, ativo: antes?.ativo ?? true }, depois: { perfil_acesso_id: b.perfil_acesso_id || null, ativo: b.ativo !== false } });
    ok(res, {});
  } catch (e) { erro(res, e); }
});
router.post('/acessos/usuarios/:id/reenviar-convite', async (req, res) => {
  try {
    const remoto = supabase.admin();
    const { data: usuario, error } = await remoto.auth.admin.getUserById(req.params.id);
    if (error || !usuario?.user?.email) throw new Error('Usuário não encontrado para reenvio do convite.');
    const { error: erroConvite } = await remoto.auth.admin.inviteUserByEmail(usuario.user.email, { redirectTo: process.env.APP_URL || 'https://sattva-reforma-tributaria.onrender.com' });
    if (erroConvite) throw erroConvite;
    auditar(req, { acao: 'Reenviou convite de usuário', entidade: 'usuario', entidadeId: req.params.id, depois: { email: usuario.user.email } });
    ok(res, { email: usuario.user.email });
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// PARÂMETROS
// ===========================================================================
router.get('/parametros', async (_req, res) => {
  try {
    // A fonte compartilhada prevalece sempre para alíquotas e parâmetros do
    // motor; SQLite é somente cache de execução do Render.
    if (supabase.configurado()) {
      await require('../services/operacaoCompartilhada').baixarConfiguracao(['param_aliquotas']);
      regras.invalidar();
    }
  const aliquotas = db.prepare('SELECT * FROM param_aliquotas ORDER BY ano').all();
  const ibsAtivo = aliquotas.some((a) => Number(a.calcular_ibs) === 1);
  // Enquanto a análise for somente CBS, a referência é 2027. A transição
  // anual permanece exclusiva da etapa de IBS.
  const referencia = aliquotas.find((a) => Number(a.ano) === 2027) || aliquotas[0] || {};
  const cronograma = Object.fromEntries(aliquotas.map((a) => [a.ano, {
    cbs: Number(a.cbs) || 0, ibs: Number(a.calcular_ibs) === 1 ? (Number(a.ibs) || 0) : 0,
    fatorIcmsIss: Number(a.fator_icms_iss) || 0, fatorPisCofins: Number(a.fator_pis_cofins) || 0,
    fatorIpi: Number(a.fator_ipi) || 0, compensavel: Number(a.compensavel) === 1, nota: a.nota || '',
  }]));
  ok(res, {
    regimes: Object.entries(P.REGIMES).map(([k, v]) => ({ chave: k, ...v })),
    reducoes: Object.entries(P.REDUCOES).map(([k, v]) => ({ chave: k, ...v })),
    cronograma, anos: ibsAtivo ? aliquotas.map((a) => a.ano) : [referencia.ano],
    aliquotaReferencia: { cbs: Number(referencia.cbs) || 0, ibs: ibsAtivo ? (Number(referencia.ibs) || 0) : 0 },
    padroes: P.PADROES, seletivo: P.IMPOSTO_SELETIVO,
    classificacao: P.CLASSIFICACAO_TRIBUTARIA,
    clausulas: CLAUSULAS, trilhas: TRILHAS,
    modoAnalise: { ibsAtivo },
  });
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// EMPRESAS
// ===========================================================================
router.get('/empresas', async (req, res) => {
  try {
    let ids = null;
    if (req.usuario && !['administrador', 'gestor'].includes(req.usuario.papel)) {
      const { data, error } = await supabase.admin().from('empresas_usuarios').select('empresa_id').eq('usuario_id', req.usuario.id);
      if (error) throw error;
      ids = (data || []).map((x) => Number(x.empresa_id)).filter(Number.isFinite);
    }
    const sql = `SELECT e.*,
    (SELECT COUNT(*) FROM parceiros p WHERE p.empresa_id = e.id AND p.tipo='fornecedor') fornecedores,
    (SELECT COUNT(*) FROM parceiros p WHERE p.empresa_id = e.id AND p.tipo='cliente') clientes,
    (SELECT COUNT(*) FROM movimentos m WHERE m.empresa_id = e.id) movimentos
    FROM empresas e ${ids === null ? '' : ids.length ? `WHERE e.id IN (${ids.map(() => '?').join(',')})` : 'WHERE 1=0'} ORDER BY e.razao_social`;
    ok(res, { empresas: db.prepare(sql).all(...(ids || [])) });
  } catch (e) { erro(res, e); }
});

router.get('/grupos-empresas', async (_req, res) => {
  try {
    const remoto = supabase.admin();
    const [{ data: grupos, error: eg }, { data: itens, error: ei }] = await Promise.all([
      remoto.from('grupos_empresas').select('*').order('nome'), remoto.from('grupos_empresas_itens').select('*'),
    ]);
    if (eg || ei) throw (eg || ei);
    ok(res, { grupos: (grupos || []).map((g) => ({ ...g, empresa_ids: (itens || []).filter((i) => i.grupo_id === g.id).map((i) => i.empresa_id) })) });
  } catch (e) { erro(res, e); }
});
router.post('/grupos-empresas', async (req, res) => {
  try {
    const b = req.body, remoto = supabase.admin(), nome = String(b.nome || '').trim();
    if (!nome) throw new Error('Informe o nome do grupo.');
    const { data: grupo, error } = await remoto.from('grupos_empresas').insert({ nome, descricao: b.descricao || '', criado_por: req.usuario?.id || null }).select().single();
    if (error) throw error;
    const itens = (b.empresa_ids || []).map((empresa_id) => ({ grupo_id: grupo.id, empresa_id }));
    if (itens.length) { const { error: ei } = await remoto.from('grupos_empresas_itens').insert(itens); if (ei) throw ei; }
    auditar(req, { acao: 'Criou grupo de empresas', entidade: 'grupo_empresas', entidadeId: grupo.id, depois: { nome: grupo.nome, empresas: itens.length } }); ok(res, { grupo });
  } catch (e) { erro(res, e); }
});
router.put('/grupos-empresas/:id', async (req, res) => {
  try {
    const b = req.body, remoto = supabase.admin(), nome = String(b.nome || '').trim();
    if (!nome) throw new Error('Informe o nome do grupo.');
    const { error } = await remoto.from('grupos_empresas').update({ nome, descricao: b.descricao || '' }).eq('id', req.params.id);
    if (error) throw error;
    const { error: er } = await remoto.from('grupos_empresas_itens').delete().eq('grupo_id', req.params.id);
    if (er) throw er;
    const itens = [...new Set((b.empresa_ids || []).map(Number).filter(Boolean))].map((empresa_id) => ({ grupo_id: req.params.id, empresa_id }));
    if (itens.length) { const { error: ei } = await remoto.from('grupos_empresas_itens').insert(itens); if (ei) throw ei; }
    auditar(req, { acao: 'Atualizou grupo de empresas', entidade: 'grupo_empresas', entidadeId: req.params.id, depois: { nome, empresas: itens.length } }); ok(res, {});
  } catch (e) { erro(res, e); }
});
router.delete('/grupos-empresas/:id', async (req, res) => {
  try {
    const { error } = await supabase.admin().from('grupos_empresas').delete().eq('id', req.params.id);
    if (error) throw error;
    auditar(req, { acao: 'Excluiu grupo de empresas', entidade: 'grupo_empresas', entidadeId: req.params.id }); ok(res, {});
  } catch (e) { erro(res, e); }
});

router.post('/empresas', async (req, res) => {
  try {
    const b = req.body;
    const cnpj = imp.soDigitos(b.cnpj);
    if (!cnpj) throw new Error('CNPJ obrigatório.');
    if (!b.razao_social) throw new Error('Razão social obrigatória.');
    const r = db.prepare(`INSERT INTO empresas (cnpj, razao_social, nome_fantasia, regime, uf, municipio,
      cnae, atividade, faturamento_anual, setor, reducao_padrao, codigo_questor, observacoes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(cnpj, b.razao_social, b.nome_fantasia || '',
      b.regime || 'lucro_real', b.uf || '', b.municipio || '', b.cnae || '', b.atividade || '',
      Number(b.faturamento_anual) || 0, b.setor || '', b.reducao_padrao || 'integral',
      b.codigo_questor || '', b.observacoes || '');
    // A empresa precisa existir primeiro na fonte compartilhada. Isso evita
    // que dados complementares recém-informados fiquem apenas no cache local
    // de uma instância efêmera do Render.
    if (supabase.configurado()) {
      await sincronizarGestaoSupabase();
    }
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.put('/empresas/:id', (req, res) => {
  try {
    const b = req.body;
    db.prepare(`UPDATE empresas SET razao_social=?, nome_fantasia=?, regime=?, uf=?, municipio=?,
      cnae=?, atividade=?, faturamento_anual=?, setor=?, reducao_padrao=?, codigo_questor=?, observacoes=?
      WHERE id=?`).run(b.razao_social, b.nome_fantasia || '', b.regime || 'lucro_real', b.uf || '',
      b.municipio || '', b.cnae || '', b.atividade || '', Number(b.faturamento_anual) || 0,
      b.setor || '', b.reducao_padrao || 'integral', b.codigo_questor || '', b.observacoes || '', req.params.id);
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.delete('/empresas/:id', async (req, res) => {
  try {
    const empresa = db.prepare('SELECT id FROM empresas WHERE id=?').get(req.params.id);
    if (!empresa) throw new Error('Empresa não encontrada.');
    // A fonte compartilhada é removida primeiro. Se uma FK ou a rede falhar,
    // o cache local continua íntegro e a empresa não some apenas de uma camada.
    if (supabase.configurado()) await excluirEmpresaSupabase(empresa.id);
    db.prepare('DELETE FROM empresas WHERE id = ?').run(empresa.id);
    ok(res, {});
  }
  catch (e) { erro(res, e); }
});

router.get('/empresas/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
  if (!e) return erro(res, new Error('Empresa não encontrada'), 404);
  ok(res, { empresa: e, perfil: db.prepare('SELECT * FROM perfil_tributario WHERE empresa_id = ? ORDER BY competencia').all(req.params.id) });
});

// ===========================================================================
// 1.a PERFIL TRIBUTÁRIO
// ===========================================================================
router.post('/empresas/:id/perfil', (req, res) => {
  try {
    const b = req.body;
    db.prepare(`INSERT INTO perfil_tributario (empresa_id, competencia, receita_bruta, receita_mercadorias,
      receita_servicos, receita_exportacao, icms, iss, ipi, pis, cofins, das, creditos_tomados, origem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.params.id, b.competencia || '',
      +b.receita_bruta || 0, +b.receita_mercadorias || 0, +b.receita_servicos || 0, +b.receita_exportacao || 0,
      +b.icms || 0, +b.iss || 0, +b.ipi || 0, +b.pis || 0, +b.cofins || 0, +b.das || 0,
      +b.creditos_tomados || 0, b.origem || 'manual');
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.delete('/perfil/:id', (req, res) => {
  db.prepare('DELETE FROM perfil_tributario WHERE id = ?').run(req.params.id); ok(res, {});
});

// Dados adicionais para diagnóstico: são entradas declaradas/evidenciadas,
// deliberadamente separadas de movimentos e de qualquer cálculo CBS.
router.get('/empresas/:id/dados-adicionais-analise', (req, res) => {
  try { ok(res, dadosAdicionaisAnalise.listar(db, Number(req.params.id))); }
  catch (e) { erro(res, e); }
});
async function publicarDadosAdicionais(empresaLocalId) {
  if (!supabase.configurado()) return;
  await sincronizarGestaoSupabase();
  const remoto = supabase.admin();
  const { data: empresas, error: erroEmpresa } = await remoto.from('empresas').select('id').eq('origem_local_id', empresaLocalId);
  if (erroEmpresa) throw erroEmpresa;
  if (empresas?.length !== 1) throw new Error('Empresa remota não localizada para publicar os dados adicionais.');
  const empresaRemotaId = empresas[0].id;
  const espelhos = [
    ['folhas_pagamento_competencias', 'empresa_id,competencia'],
    ['margens_operacionais_premissas', 'empresa_id,periodo_inicio,periodo_fim'],
    ['receitas_sem_dfe', 'empresa_id,chave_deduplicacao'],
  ];
  for (const [tabela, conflito] of espelhos) {
    const linhas = db.prepare(`SELECT * FROM ${tabela} WHERE empresa_id=?`).all(empresaLocalId)
      .map(({ id, ...linha }) => ({ ...linha, empresa_id: empresaRemotaId }));
    if (!linhas.length) continue;
    const { error } = await remoto.from(tabela).upsert(linhas, { onConflict: conflito });
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
}
router.post('/empresas/:id/folhas-pagamento', async (req, res) => {
  try {
    const resultado = dadosAdicionaisAnalise.salvarFolha(db, Number(req.params.id), req.body || {});
    await publicarDadosAdicionais(Number(req.params.id));
    ok(res, resultado);
  }
  catch (e) { erro(res, e); }
});
router.post('/empresas/:id/margens-operacionais', async (req, res) => {
  try {
    const resultado = dadosAdicionaisAnalise.salvarMargem(db, Number(req.params.id), req.body || {});
    await publicarDadosAdicionais(Number(req.params.id));
    ok(res, resultado);
  }
  catch (e) { erro(res, e); }
});
router.post('/empresas/:id/receitas-sem-dfe', async (req, res) => {
  try {
    const resultado = dadosAdicionaisAnalise.salvarReceitaSemDfe(db, Number(req.params.id), req.body || {});
    await publicarDadosAdicionais(Number(req.params.id));
    ok(res, resultado);
  }
  catch (e) { erro(res, e); }
});

// Ingestão de apuração histórica: preserva o arquivo e armazena somente os
// valores que a IA localizar. Não cria movimentos e não executa o motor CBS.
function textoApuracaoArquivo(arquivo, tipoDocumento) {
  if (tipoDocumento === 'CSV') return arquivo.buffer.toString('utf8');
  if (tipoDocumento === 'XLSX') {
    const livro = XLSX.read(arquivo.buffer, { type: 'buffer' });
    return livro.SheetNames.map((nome) => `## ${nome}\n${XLSX.utils.sheet_to_csv(livro.Sheets[nome])}`).join('\n\n');
  }
  return null;
}
async function extrairDocumentoApuracao(arquivo, tipoDocumento) {
  const textoEstruturado = textoApuracaoArquivo(arquivo, tipoDocumento);
  if (textoEstruturado) return { texto: textoEstruturado, metodo: 'LEITURA_ESTRUTURADA_LOCAL', modelo: 'XLSX_CSV' };
  if (!azureDocumentIntelligence.config().ativo) {
    throw new Error('OCR Azure Document Intelligence não configurado para documentos não estruturados.');
  }
  return azureDocumentIntelligence.extrair(arquivo);
}
function jsonIa(texto) {
  const limpo = String(texto || '').replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  const inicio = limpo.indexOf('{'), fim = limpo.lastIndexOf('}');
  if (inicio < 0 || fim < inicio) throw new Error('A IA não retornou JSON estruturado para a apuração.');
  return JSON.parse(limpo.slice(inicio, fim + 1));
}
function diagnosticoRuntimeIngestaoPisCofins() {
  const azure = azureDocumentIntelligence.diagnosticoSeguro();
  return {
    ...azure,
    provider_normalizacao: 'DETERMINISTICA_AZURE',
    llm_normalizacao_configurado: false,
    motivo_normalizacao_inativa: null,
  };
}
router.get('/empresas/:id/apuracoes-pis-cofins/diagnostico-runtime', (_req, res) => {
  try { ok(res, diagnosticoRuntimeIngestaoPisCofins()); }
  catch (e) { erro(res, e); }
});
router.post('/empresas/:id/apuracoes-pis-cofins/ingestao', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error('Envie o documento de apuração no campo "arquivo".');
    const tipoDocumento = String(req.body?.tipo_documento || '').toUpperCase();
    if (!['PDF', 'XLSX', 'CSV', 'RELATORIO_ERP'].includes(tipoDocumento)) throw new Error('Informe o tipo do documento: PDF, XLSX, CSV ou RELATORIO_ERP.');
    const extracaoDocumento = await extrairDocumentoApuracao(req.file, tipoDocumento);
    const textoDocumento = extracaoDocumento.texto;
    if (!String(textoDocumento || '').trim()) throw new Error('Não foi possível obter texto do documento de apuração.');
    const extraido = apuracoesPisCofinsIa.normalizarTextoDeterministico(textoDocumento, {
      localizacoes: extracaoDocumento.localizacoes, metodo: 'NORMALIZACAO_DETERMINISTICA_AZURE',
    });
    const resultado = apuracoesPisCofinsIa.ingestao(db, Number(req.params.id), {
      nome_original: req.file.originalname, tipo_documento: tipoDocumento, mime_type: req.file.mimetype,
      conteudo_original: req.file.buffer, versao_modelo_extracao: `${extracaoDocumento.modelo} + NORMALIZACAO_DETERMINISTICA_V1`,
    }, extraido);
    ok(res, { ...resultado, campos_pendentes: resultado.campos.filter((x) => x.status_validacao !== 'VALIDADO_AUTOMATICAMENTE').map((x) => x.campo) });
  } catch (e) { erro(res, e); }
});
router.get('/empresas/:id/apuracoes-pis-cofins', (req, res) => {
  try { ok(res, { apuracoes: apuracoesPisCofinsIa.listarParaRevisao(db, Number(req.params.id)) }); }
  catch (e) { erro(res, e); }
});
router.post('/empresas/:id/apuracoes-pis-cofins/:apuracaoId/confirmar', (req, res) => {
  try { ok(res, { apuracao: apuracoesPisCofinsIa.confirmarRevisao(db, Number(req.params.id), Number(req.params.apuracaoId)) }); }
  catch (e) { erro(res, e); }
});

router.get('/empresas/:id/perfil/analise', (req, res) => {
  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
    if (!empresa) throw new Error('Empresa não encontrada');
    const linhas = db.prepare('SELECT * FROM perfil_tributario WHERE empresa_id = ? ORDER BY competencia').all(req.params.id);
    ok(res, { analise: analisarPerfil(empresa, linhas) });
  } catch (e) { erro(res, e); }
});

// Camada executiva de leitura: não materializa CBS nem executa o motor.
router.get('/empresas/:id/perfil-tributario-historico', (req, res) => {
  try { ok(res, perfilTributarioHistorico.consolidar(db, Number(req.params.id))); }
  catch (e) { erro(res, e); }
});

router.get('/empresas/:id/comparador-regimes', async (req, res) => {
  try {
    if (supabase.configurado()) await require('../services/operacaoCompartilhada').baixarParametrosIrpjCsll();
    ok(res, comparadorRegimes.comparar(db, Number(req.params.id)));
  }
  catch (e) { erro(res, e); }
});

// Perfil CBS: lê exclusivamente o resultado já produzido pelo motor e a
// competência do movimento. Não cria cálculo tributário paralelo.
router.get('/empresas/:id/perfil-cbs', (req, res) => {
  try {
    const detectadas = db.prepare("SELECT COUNT(DISTINCT competencia) c FROM movimentos WHERE empresa_id=? AND COALESCE(competencia,'')<>''").get(req.params.id).c;
    ok(res, { competencias: perfilCbs.listar(req.params.id), competencias_detectadas: detectadas, ultima_execucao: motorExec.ultimaExecucao(req.params.id) });
  }
  catch (e) { erro(res, e); }
});
router.post('/empresas/:id/perfil-cbs/atualizar', (req, res) => {
  try { ok(res, perfilCbs.materializar(req.params.id, { forcar: req.body?.forcar === true })); }
  catch (e) { erro(res, e); }
});
router.get('/empresas/:id/perfil-cbs/:competencia/detalhes', (req, res) => {
  try { ok(res, { operacoes: perfilCbs.detalhes(req.params.id, req.params.competencia, { sentido: req.query.sentido }) }); }
  catch (e) { erro(res, e); }
});

function analisarPerfil(empresa, linhas) {
  const s = (f) => linhas.reduce((a, l) => a + (Number(l[f]) || 0), 0);
  const receita = s('receita_bruta');
  const tributos = s('icms') + s('iss') + s('ipi') + s('pis') + s('cofins') + s('das');
  const creditos = s('creditos_tomados');
  const cargaBruta = receita ? tributos / receita : 0;
  const cargaLiquida = receita ? (tributos - creditos) / receita : 0;
  const merc = s('receita_mercadorias'), serv = s('receita_servicos'), exp = s('receita_exportacao');
  const totalComp = merc + serv + exp || receita || 1;

  const aliquotasProjeto = db.prepare('SELECT * FROM param_aliquotas ORDER BY ano').all();
  const ibsAtivo = aliquotasProjeto.some((a) => Number(a.calcular_ibs) === 1);
  const referenciaCbs = aliquotasProjeto.find((a) => Number(a.ano) === 2027) || aliquotasProjeto[0];
  const anos = ibsAtivo ? aliquotasProjeto.map((a) => Number(a.ano)) : [Number(referenciaCbs?.ano || 2027)];
  const projecao = anos.map((ano) => {
    const cron = aliquotasProjeto.find((a) => Number(a.ano) === Number(ano)) || referenciaCbs || {};
    const reducao = regras.percentualReducao(empresa.reducao_padrao || 'integral');
    const cbs = Number(cron.cbs) || 0;
    const ibs = Number(cron.calcular_ibs) === 1 ? (Number(cron.ibs) || 0) : 0;
    const aliq = (cbs + ibs) * (1 - reducao);
    const baseLimpa = receita - tributos;
    const residual = (s('icms') + s('iss')) * (Number(cron.fator_icms_iss) || 0) + (s('pis') + s('cofins')) * (Number(cron.fator_pis_cofins) || 0) + s('ipi') * (Number(cron.fator_ipi) || 0) + s('das') * (Number(cron.fator_icms_iss) || 0);
    const iva = Number(cron.compensavel) === 1 ? 0 : baseLimpa * aliq;
    const total = residual + iva;
    return { ano, nota: cron.nota || '', aliquotaIva: calc.r4(aliq), tributos: calc.r2(total),
      carga: receita ? calc.r4(total / (baseLimpa + total)) : 0,
      variacao: calc.r2(total - tributos) };
  });

  const observacoes = [];
  const regime = P.REGIMES[empresa.regime] || {};
  observacoes.push({ nivel: 'info', texto: `Regime vigente: ${regime.label || empresa.regime}. ${regime.obs || ''}` });
  if (serv / totalComp > 0.5 && ['lucro_presumido', 'simples_nacional'].includes(empresa.regime)) {
    observacoes.push({ nivel: 'alto', texto: 'Receita majoritariamente de serviços em regime cumulativo/Simples: perfil de maior aumento de carga na reforma, por gerar poucos créditos de entrada e sofrer alíquota cheia na saída. Avaliar redução de 30% para profissões regulamentadas e regimes específicos.' });
  }
  if (exp / totalComp > 0.15) {
    observacoes.push({ nivel: 'bom', texto: 'Presença relevante de exportação: imunidade com manutenção integral do crédito. Tende a gerar acúmulo de saldo credor e direito a ressarcimento — planejar o fluxo de caixa dessa recuperação.' });
  }
  if (empresa.regime === 'simples_nacional') {
    observacoes.push({ nivel: 'alto', texto: 'Decisão central: permanecer no DAS (sem crédito para o cliente PJ) ou optar pelo regime regular de IBS/CBS. Se a carteira é B2B de empresas que se creditam, a permanência no DAS pode custar competitividade.' });
  }
  if (cargaBruta > 0.25) {
    observacoes.push({ nivel: 'atencao', texto: `Carga tributária bruta atual de ${(cargaBruta * 100).toFixed(2).replace('.', ',')}% sobre a receita — acima da média. Confirmar aproveitamento integral dos créditos disponíveis hoje.` });
  }
  return {
    competencias: linhas.length, receita: calc.r2(receita), tributos: calc.r2(tributos),
    creditos: calc.r2(creditos), cargaBruta: calc.r4(cargaBruta), cargaLiquida: calc.r4(cargaLiquida),
    composicao: { mercadorias: calc.r4(merc / totalComp), servicos: calc.r4(serv / totalComp), exportacao: calc.r4(exp / totalComp) },
    detalheTributos: { icms: calc.r2(s('icms')), iss: calc.r2(s('iss')), ipi: calc.r2(s('ipi')),
      pis: calc.r2(s('pis')), cofins: calc.r2(s('cofins')), das: calc.r2(s('das')) },
    projecao, observacoes,
  };
}

// ===========================================================================
// PARCEIROS (clientes e fornecedores)
// ===========================================================================
router.get('/empresas/:id/parceiros', (req, res) => {
  const tipo = req.query.tipo;
  const sql = tipo ? 'SELECT * FROM parceiros WHERE empresa_id = ? AND tipo = ? ORDER BY descricao'
                   : 'SELECT * FROM parceiros WHERE empresa_id = ? ORDER BY tipo, descricao';
  ok(res, { parceiros: tipo ? db.prepare(sql).all(req.params.id, tipo) : db.prepare(sql).all(req.params.id) });
});

router.post('/empresas/:id/parceiros', (req, res) => {
  try {
    const b = req.body;
    db.prepare(`INSERT INTO parceiros (empresa_id, tipo, cnpj, descricao, regime, uf, municipio, origem)
      VALUES (?,?,?,?,?,?,?, 'manual')
      ON CONFLICT(empresa_id, tipo, cnpj) DO UPDATE SET descricao=excluded.descricao, regime=excluded.regime`)
      .run(req.params.id, b.tipo, imp.soDigitos(b.cnpj), b.descricao || '', b.regime || 'indeterminado', b.uf || '', b.municipio || '');
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.put('/parceiros/:id', (req, res) => {
  try {
    const b = req.body;
    db.prepare('UPDATE parceiros SET descricao=?, regime=?, uf=?, municipio=? WHERE id=?')
      .run(b.descricao || '', b.regime || 'indeterminado', b.uf || '', b.municipio || '', req.params.id);
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.delete('/parceiros/:id', (req, res) => {
  db.prepare('DELETE FROM parceiros WHERE id = ?').run(req.params.id); ok(res, {});
});

// ===========================================================================
// IMPORTAÇÕES
// ===========================================================================
router.get('/modelos/:tipo', (req, res) => {
  const tipos = { parceiros: 'Modelo_Cadastro_Clientes_Fornecedores', movimento_fornecedor: 'Modelo_Movimentacao_Fornecedores', movimento_cliente: 'Modelo_Movimentacao_Clientes', referencias_servicos: 'Modelo_Referencias_Fiscais_Servicos', pgdas: 'Modelo_PGDAS' };
  if (!tipos[req.params.tipo]) return erro(res, new Error('Modelo inexistente'), 404);
  const buf = imp.gerarModelo(req.params.tipo);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${tipos[req.params.tipo]}.xlsx"`);
  res.send(buf);
});

router.post('/empresas/:id/importar/parceiros', upload.single('arquivo'), (req, res) => {
  try {
    if (!req.file) throw new Error('Envie a planilha no campo "arquivo".');
    const tipo = req.body.tipo === 'cliente' ? 'cliente' : 'fornecedor';
    const r = imp.importarParceiros(req.file.buffer, tipo);
    const ins = db.prepare(`INSERT INTO parceiros (empresa_id, tipo, cnpj, descricao, regime, uf, municipio, origem)
      VALUES (?,?,?,?,?,?,?, 'planilha')
      ON CONFLICT(empresa_id, tipo, cnpj) DO UPDATE SET descricao=excluded.descricao,
        regime=excluded.regime, uf=excluded.uf, municipio=excluded.municipio`);
    let n = 0;
    db.transaction(() => { for (const p of r.registros) { ins.run(req.params.id, tipo, p.cnpj, p.descricao, p.regime, p.uf, p.municipio); n++; } })();
    // Vincula regimes à movimentação já importada
    vincularRegimes(req.params.id);
    ok(res, { importados: n, ignorados: r.ignorados, mensagens: r.mensagens, colunasDetectadas: r.mapa, colunasArquivo: r.colunas });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/importar/movimentos', upload.single('arquivo'), (req, res) => {
  try {
    if (!req.file) throw new Error('Envie a planilha no campo "arquivo".');
    const tipo = req.body.tipo === 'cliente' ? 'cliente' : 'fornecedor';
    const r = imp.importarMovimentos(req.file.buffer, tipo);
    const lote = db.prepare('INSERT INTO lotes (empresa_id, tipo, arquivo, registros, ignorados, mensagens) VALUES (?,?,?,?,?,?)')
      .run(req.params.id, tipo, req.file.originalname, r.registros.length, r.ignorados || 0, JSON.stringify(r.mensagens));
    const ins = db.prepare(`INSERT INTO movimentos (empresa_id, lote_id, tipo, nome, inscr_federal, descricao,
      ncm, nbs, cfop, cst, competencia, valor, base_calculo, icms, icms_st, ipi, pis, cofins, iss, reducao)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let total = 0;
    db.transaction(() => {
      for (const m of r.registros) {
        ins.run(req.params.id, lote.lastInsertRowid, tipo, m.nome, m.inscr_federal, m.descricao, m.ncm, m.nbs,
          m.cfop, m.cst, m.competencia, m.valor, m.base_calculo, m.icms, m.icms_st, m.ipi, m.pis, m.cofins, m.iss, m.reducao);
        total += m.valor;
      }
    })();
    db.prepare('UPDATE lotes SET valor_total = ? WHERE id = ?').run(total, lote.lastInsertRowid);
    const vinc = vincularRegimes(req.params.id);
    // Classifica automaticamente pelas bases de NCM/NBS, quando carregadas
    let classificacao = null;
    try {
      const temBase = db.prepare('SELECT (SELECT COUNT(*) FROM base_ncm) + (SELECT COUNT(*) FROM base_servicos) c').get().c;
      if (temBase) classificacao = bases.classificarMovimentos(req.params.id);
    } catch (_) { /* bases ausentes: segue com tributação integral */ }
    ok(res, { importados: r.registros.length, ignorados: r.ignorados, valorTotal: calc.r2(total),
      mensagens: r.mensagens, colunasDetectadas: r.mapa, colunasArquivo: r.colunas, classificacao, ...vinc });
  } catch (e) { erro(res, e); }
});

// PGDAS é evidência histórica do Simples Nacional. Os campos ausentes
// permanecem nulos no importador e não são convertidos em zero.
router.post('/empresas/:id/importar/pgdas', upload.single('arquivo'), (req, res) => {
  try {
    if (!req.file) throw new Error('Envie o arquivo XLSX, XLS ou CSV no campo "arquivo".');
    const empresa = db.prepare('SELECT id, regime FROM empresas WHERE id=?').get(req.params.id);
    if (!empresa) throw new Error('Empresa não encontrada.');
    if (empresa.regime !== 'simples_nacional') throw new Error('A importação de PGDAS está disponível somente para empresas do Simples Nacional.');
    const r = imp.importarPgdas(req.file.buffer);
    if (!r.registros.length) throw new Error('Nenhuma apuração PGDAS válida foi encontrada. Informe Competência e DAS em cada linha.');

    const existente = db.prepare('SELECT id FROM perfil_tributario WHERE empresa_id=? AND competencia=? ORDER BY id DESC LIMIT 1');
    const inserir = db.prepare(`INSERT INTO perfil_tributario (empresa_id, competencia, receita_bruta, receita_mercadorias,
      receita_servicos, receita_exportacao, pis, cofins, das, origem)
      VALUES (?,?,?,?,?,?,?,?,?, 'pgdas_importado')`);
    const atualizar = db.prepare(`UPDATE perfil_tributario SET receita_bruta=COALESCE(?, receita_bruta),
      receita_mercadorias=COALESCE(?, receita_mercadorias), receita_servicos=COALESCE(?, receita_servicos),
      receita_exportacao=COALESCE(?, receita_exportacao), pis=COALESCE(?, pis), cofins=COALESCE(?, cofins),
      das=?, origem='pgdas_importado' WHERE id=?`);
    let importados = 0;
    let atualizados = 0;
    db.transaction(() => {
      for (const p of r.registros) {
        const valores = [p.receita_bruta, p.receita_mercadorias, p.receita_servicos, p.receita_exportacao, p.pis, p.cofins];
        const perfil = existente.get(req.params.id, p.competencia);
        if (perfil) {
          atualizar.run(...valores, p.das, perfil.id);
          atualizados++;
        } else {
          inserir.run(req.params.id, p.competencia, ...valores, p.das);
          importados++;
        }
      }
    })();
    ok(res, { importados, atualizados, ignorados: r.ignorados, mensagens: r.mensagens,
      colunasDetectadas: r.mapa, colunasArquivo: r.colunas });
  } catch (e) { erro(res, e); }
});

/** Cruza a movimentação com o cadastro de parceiros para resolver o regime */
function vincularRegimes(empresaId) {
  db.prepare(`UPDATE movimentos SET regime = (
      SELECT p.regime FROM parceiros p
      WHERE p.empresa_id = movimentos.empresa_id AND p.tipo = movimentos.tipo
        AND p.cnpj = movimentos.inscr_federal)
    WHERE empresa_id = ? AND inscr_federal IS NOT NULL AND inscr_federal <> ''`).run(empresaId);
  const semRegime = db.prepare(`SELECT COUNT(*) c FROM movimentos WHERE empresa_id = ? AND (regime IS NULL OR regime = '')`).get(empresaId).c;
  const naoCadastrados = db.prepare(`SELECT DISTINCT inscr_federal, nome, tipo FROM movimentos m
    WHERE m.empresa_id = ? AND (m.regime IS NULL OR m.regime = '') AND m.inscr_federal <> '' LIMIT 200`).all(empresaId);
  return { semRegime, naoCadastrados };
}

function agendarEnriquecimentoAutomatico(empresaId) {
  const fila = cnpjReceita.agendarEnriquecimento(empresaId);
  // O motor só é persistido após a fila concluir, para que Classificações
  // reflita automaticamente os cadastros encontrados.
  if (fila.status === 'agendado') {
    const aguardar = setInterval(() => {
      if (fila.status === 'agendado' || fila.status === 'executando') return;
      clearInterval(aguardar);
      if (fila.status === 'concluido' && fila.resultado && fila.resultado.atualizados) {
        try { motorExec.reprocessarIncremental(empresaId, { ano: 2027 }); } catch (_) { /* a fila retomará no próximo ciclo */ }
      }
    }, 1000);
  }
  return fila;
}

router.post('/empresas/:id/vincular-regimes', (req, res) => ok(res, vincularRegimes(req.params.id)));

router.get('/empresas/:id/lotes', (req, res) => ok(res, {
  lotes: db.prepare('SELECT * FROM lotes WHERE empresa_id = ? ORDER BY id DESC').all(req.params.id),
}));

router.delete('/lotes/:id', (req, res) => {
  db.prepare('DELETE FROM movimentos WHERE lote_id = ?').run(req.params.id);
  db.prepare('DELETE FROM lotes WHERE id = ?').run(req.params.id);
  ok(res, {});
});

router.get('/empresas/:id/movimentos', (req, res) => {
  const tipo = req.query.tipo || 'fornecedor';
  const limite = Math.min(Number(req.query.limite) || 300, 5000);
  ok(res, {
    movimentos: db.prepare('SELECT * FROM movimentos WHERE empresa_id = ? AND tipo = ? ORDER BY valor DESC LIMIT ?').all(req.params.id, tipo, limite),
    total: db.prepare('SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM movimentos WHERE empresa_id = ? AND tipo = ?').get(req.params.id, tipo),
  });
});

// ===========================================================================
// CALCULADORA
// ===========================================================================
router.post('/calculadora', (req, res) => {
  try { ok(res, { resultado: calc.calcularOperacao(req.body) }); }
  catch (e) { erro(res, e); }
});

// ===========================================================================
// DIAGNÓSTICO — CADEIAS E CENÁRIOS
// ===========================================================================
function carregarMovimentos(empresaId, tipo) {
  return db.prepare(`SELECT m.*, COALESCE(NULLIF(m.regime,''), p.regime, 'lucro_real') regime,
      COALESCE(p.descricao, m.nome) nome_parceiro, m.inscr_federal cnpj
    FROM movimentos m
    LEFT JOIN parceiros p ON p.empresa_id = m.empresa_id AND p.tipo = m.tipo AND p.cnpj = m.inscr_federal
    WHERE m.empresa_id = ? AND m.tipo = ?`).all(empresaId, tipo)
    .map((m) => ({ ...m, nome: m.nome_parceiro || m.nome }));
}

function chaveReferenciaServico(m) {
  const nbs = String(m.nbs || '').replace(/\D/g, '');
  if (nbs) return `nbs:${nbs}`;
  return `descricao:${String(m.descricao || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160)}`;
}

function encontrarReferenciaServico(m, mapa) {
  return mapa.get(chaveReferenciaServico(m))
    || mapa.get(chaveReferenciaServico({ descricao: m.descricao }))
    || null;
}

// Documentos antigos nem sempre trazem NBS. ISS destacado ou ausência de NCM
// são os sinais disponíveis para tratá-los como serviço e exigir a referência.
function ehServicoDeVenda(m) {
  return Boolean(String(m.nbs || '').replace(/\D/g, ''))
    || Number(m.iss || 0) !== 0
    || (!String(m.ncm || '').replace(/\D/g, '') && Boolean(String(m.descricao || '').trim()));
}

// A referência é uma premissa para documentos antigos ou sem detalhamento.
// Quando o XML já traz PIS/COFINS efetivamente destacado, ele é a evidência
// prioritária do motor e não deve bloquear a leitura da cadeia.
function requerReferenciaFiscalServico(m) {
  return ehServicoDeVenda(m) && (Number(m.pis || 0) + Number(m.cofins || 0) <= 0);
}

function prepararCadeia(empresa, tipo, query = {}) {
  let movimentos = carregarMovimentos(empresa.id, tipo);
  if (tipo === 'cliente') {
    const refs = db.prepare('SELECT * FROM empresa_servicos_fiscais WHERE empresa_id=? AND ativo=1').all(empresa.id);
    const mapaRefs = new Map(refs.map((r) => [r.chave, r]));
    movimentos = movimentos.map((m) => ({ ...m, referenciaFiscal: encontrarReferenciaServico(m, mapaRefs) }));
    const pendentes = movimentos.filter((m) => requerReferenciaFiscalServico(m) && !m.referenciaFiscal);
    // Referências da empresa melhoram a reconstrução, mas ausência não pode
    // impedir a análise. O motor mantém documento, catálogo e regime como
    // precedências e devolve a pendência para revisão humana.
    query.pendenciasReferencias = pendentes;
  }
  const aliquotas = db.prepare('SELECT * FROM param_aliquotas ORDER BY ano').all();
  const ibsAtivo = aliquotas.some((a) => Number(a.calcular_ibs) === 1);
  const referencia = aliquotas.find((a) => Number(a.ano) === 2027) || aliquotas[0];
  const anos = query.anos ? String(query.anos).split(',').map(Number)
    : (ibsAtivo ? aliquotas.map((a) => Number(a.ano)) : [Number(referencia?.ano || 2027)]);
  return { movimentos, anos, parametrosIVA: ibsAtivo ? Object.fromEntries(aliquotas.map((a) => [Number(a.ano), a])) : referencia,
    pendenciasReferencias: query.pendenciasReferencias || [] };
}

function referenciaIvaDoProjeto() {
  const linhas = db.prepare('SELECT * FROM param_aliquotas ORDER BY ano').all();
  const ibsAtivo = linhas.some((a) => Number(a.calcular_ibs) === 1);
  if (ibsAtivo) return Object.fromEntries(linhas.map((a) => [Number(a.ano), a]));
  return linhas.find((a) => Number(a.ano) === 2027) || linhas[0];
}

function referenciaFiscalPrecificacao(empresaId, item, exigir = true) {
  if (item.tipo !== 'servico') return null;
  const chave = chaveReferenciaServico(item);
  const referencia = db.prepare('SELECT * FROM empresa_servicos_fiscais WHERE empresa_id=? AND chave=? AND ativo=1').get(empresaId, chave);
  if (!referencia && exigir) throw new Error(`O serviço “${item.descricao || 'sem descrição'}” exige referência fiscal antes da precificação. Cadastre PIS/COFINS ou DAS efetivo em Cadastros e importação → Clientes.`);
  return referencia || null;
}

const temAliquotaInformada = (valor) => valor !== '' && valor !== null && valor !== undefined;
const normalizarAliquota = (valor) => {
  const texto = String(valor == null ? '' : valor).trim();
  const percentual = texto.includes('%');
  const n = imp.numeroBR(texto.replace(/%/g, ''));
  return percentual || n > 1 ? n / 100 : n;
};

router.get('/empresas/:id/referencias-vendas', (req, res) => {
  try {
    const referencias = db.prepare('SELECT * FROM empresa_servicos_fiscais WHERE empresa_id=? ORDER BY descricao').all(req.params.id);
    const mapa = new Map(referencias.filter((r) => r.ativo).map((r) => [r.chave, r]));
    const porChave = new Map();
    db.prepare(`SELECT nbs, ncm, iss, pis, cofins, descricao, valor FROM movimentos WHERE empresa_id=? AND tipo='cliente'`).all(req.params.id)
      .filter(ehServicoDeVenda).forEach((m) => {
        const chave = chaveReferenciaServico(m);
        const atual = porChave.get(chave) || { chave, nbs: m.nbs || '', descricao: m.descricao || 'Serviço sem descrição', registros: 0, valor: 0, registrosSemDocumento: 0 };
        atual.registros += 1;
        atual.valor += Number(m.valor) || 0;
        if (requerReferenciaFiscalServico(m)) atual.registrosSemDocumento += 1;
        porChave.set(chave, atual);
      });
    // Mantém no catálogo também serviços preparados antes da primeira venda.
    referencias.filter((r) => r.ativo).forEach((r) => {
      if (!porChave.has(r.chave)) porChave.set(r.chave, { chave: r.chave, nbs: r.nbs || '', descricao: r.descricao || 'Serviço', registros: 0, valor: 0, registrosSemDocumento: 0 });
    });
    const servicos = [...porChave.values()].sort((a, b) => b.valor - a.valor)
      .map((s) => {
        const direta = mapa.get(s.chave) || null;
        const referencia = direta || encontrarReferenciaServico(s, mapa);
        const exigeReferencia = s.registrosSemDocumento > 0;
        return { ...s, configurado: Boolean(referencia), exigeReferencia, coberto: Boolean(referencia) || !exigeReferencia, referencia,
          correspondencia: !referencia ? '' : (direta ? (s.nbs ? 'NBS' : 'descrição') : 'descrição reaproveitada') };
      });
    ok(res, { referencias, servicos, pendentes: servicos.filter((s) => s.exigeReferencia && !s.configurado) });
  } catch (e) { erro(res, e); }
});

router.put('/empresas/:id/referencias-vendas/:chave', (req, res) => {
  try {
    const b = req.body;
    if (!temAliquotaInformada(b.pis_cofins) && !temAliquotaInformada(b.das_efetivo)) throw new Error('Informe PIS/COFINS ou a alíquota efetiva do DAS para esta venda de serviço.');
    const antes = db.prepare('SELECT nbs, descricao, pis_cofins, das_efetivo, iss_aliquota FROM empresa_servicos_fiscais WHERE empresa_id=? AND chave=?').get(req.params.id, req.params.chave);
    db.prepare(`INSERT INTO empresa_servicos_fiscais (empresa_id,chave,nbs,descricao,pis_cofins,das_efetivo,iss_aliquota,ativo,origem,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(empresa_id,chave) DO UPDATE SET nbs=excluded.nbs, descricao=excluded.descricao,
      pis_cofins=excluded.pis_cofins,das_efetivo=excluded.das_efetivo,iss_aliquota=excluded.iss_aliquota,ativo=excluded.ativo,origem=excluded.origem,atualizado_em=excluded.atualizado_em`)
      .run(req.params.id, req.params.chave, b.nbs || '', b.descricao || 'Serviço', temAliquotaInformada(b.pis_cofins) ? normalizarAliquota(b.pis_cofins) : null, temAliquotaInformada(b.das_efetivo) ? normalizarAliquota(b.das_efetivo) : null, temAliquotaInformada(b.iss_aliquota) ? normalizarAliquota(b.iss_aliquota) : null, 1, 'manual');
    auditar(req, { empresaId: req.params.id, acao: antes ? 'Atualizou referência fiscal de serviço' : 'Criou referência fiscal de serviço', entidade: 'referencia_fiscal_servico', entidadeId: req.params.chave, antes, depois: { nbs: b.nbs || '', descricao: b.descricao || 'Serviço', pis_cofins: temAliquotaInformada(b.pis_cofins) ? normalizarAliquota(b.pis_cofins) : null, das_efetivo: temAliquotaInformada(b.das_efetivo) ? normalizarAliquota(b.das_efetivo) : null, iss_aliquota: temAliquotaInformada(b.iss_aliquota) ? normalizarAliquota(b.iss_aliquota) : null } });
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/referencias-vendas', (req, res) => {
  try {
    const b = req.body || {};
    const descricao = String(b.descricao || '').trim();
    if (!descricao) throw new Error('Informe a descrição do serviço.');
    if (!temAliquotaInformada(b.pis_cofins) && !temAliquotaInformada(b.das_efetivo)) throw new Error('Informe PIS/COFINS ou a alíquota efetiva do DAS para este serviço.');
    const chave = chaveReferenciaServico({ nbs: b.nbs, descricao });
    db.prepare(`INSERT INTO empresa_servicos_fiscais (empresa_id,chave,nbs,descricao,pis_cofins,das_efetivo,iss_aliquota,ativo,origem,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(empresa_id,chave) DO UPDATE SET nbs=excluded.nbs, descricao=excluded.descricao,
      pis_cofins=excluded.pis_cofins,das_efetivo=excluded.das_efetivo,iss_aliquota=excluded.iss_aliquota,ativo=excluded.ativo,origem=excluded.origem,atualizado_em=excluded.atualizado_em`)
      .run(req.params.id, chave, b.nbs || '', descricao, temAliquotaInformada(b.pis_cofins) ? normalizarAliquota(b.pis_cofins) : null, temAliquotaInformada(b.das_efetivo) ? normalizarAliquota(b.das_efetivo) : null, temAliquotaInformada(b.iss_aliquota) ? normalizarAliquota(b.iss_aliquota) : null, 1, 'manual');
    auditar(req, { empresaId: req.params.id, acao: 'Criou referência fiscal de serviço', entidade: 'referencia_fiscal_servico', entidadeId: chave, depois: { nbs: b.nbs || '', descricao, pis_cofins: temAliquotaInformada(b.pis_cofins) ? normalizarAliquota(b.pis_cofins) : null, das_efetivo: temAliquotaInformada(b.das_efetivo) ? normalizarAliquota(b.das_efetivo) : null, iss_aliquota: temAliquotaInformada(b.iss_aliquota) ? normalizarAliquota(b.iss_aliquota) : null } });
    ok(res, { chave });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/referencias-vendas/importar', upload.single('arquivo'), (req, res) => {
  try {
    if (!req.file) throw new Error('Envie a planilha de referências fiscais.');
    const { linhas } = imp.lerPlanilha(req.file.buffer);
    const normalizarColuna = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const campo = (linha, nomes) => {
      for (const chave of Object.keys(linha)) if (nomes.includes(normalizarColuna(chave))) return linha[chave];
      return '';
    };
    const gravar = db.prepare(`INSERT INTO empresa_servicos_fiscais (empresa_id,chave,nbs,descricao,pis_cofins,das_efetivo,iss_aliquota,ativo,origem,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(empresa_id,chave) DO UPDATE SET nbs=excluded.nbs, descricao=excluded.descricao,
      pis_cofins=excluded.pis_cofins,das_efetivo=excluded.das_efetivo,iss_aliquota=excluded.iss_aliquota,ativo=excluded.ativo,origem=excluded.origem,atualizado_em=excluded.atualizado_em`);
    let importados = 0, ignorados = 0;
    db.transaction(() => {
      for (const linha of linhas) {
        const descricao = String(campo(linha, ['descricao', 'servico', 'item', 'descricaodoservico']) || '').trim();
        const nbs = String(campo(linha, ['nbs', 'codigonbs']) || '').trim();
        const brutoPis = campo(linha, ['piscofins', 'aliquotapiscofins', 'piscofinsdavenda']);
        const brutoDas = campo(linha, ['das', 'dasefetivo', 'aliquotadas']);
        const brutoIss = campo(linha, ['iss', 'aliquotaiss']);
        if (!descricao) { ignorados++; continue; }
        const temPis = brutoPis !== '' && brutoPis !== null && brutoPis !== undefined;
        const temDas = brutoDas !== '' && brutoDas !== null && brutoDas !== undefined;
        if (!temPis && !temDas) throw new Error(`O serviço “${descricao}” não informa PIS/COFINS nem DAS efetivo.`);
        const chave = chaveReferenciaServico({ nbs, descricao });
        gravar.run(req.params.id, chave, nbs, descricao,
          temPis ? normalizarAliquota(brutoPis) : null, temDas ? normalizarAliquota(brutoDas) : null,
          brutoIss === '' || brutoIss === null || brutoIss === undefined ? null : normalizarAliquota(brutoIss), 1, 'importacao');
        importados++;
      }
    })();
    auditar(req, { empresaId: req.params.id, acao: 'Importou referências fiscais de serviços', entidade: 'referencia_fiscal_servico', entidadeId: 'importacao', depois: { importados, ignorados } });
    ok(res, { importados, ignorados });
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/cadeia/:tipo', async (req, res) => {
  try {
    await atualizarConfiguracaoDeCalculo();
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
    if (!empresa) throw new Error('Empresa não encontrada');
    const tipo = req.params.tipo === 'cliente' ? 'cliente' : 'fornecedor';
    // A execução é materializada antes da leitura. A cadeia apenas agrega
    // motor_resultados; ela não recalcula base, CBS, IBS ou crédito.
    // Leitura operacional nunca refaz a empresa inteira. Só atualiza a
    // fotografia se alguma dependência efetivamente mudou.
    motorExec.reprocessarIncremental(empresa.id, { ano: 2027 });
    const cfg = prepararCadeia(empresa, tipo, req.query);
    const resultado = consolidacaoOficial.cadeia(empresa.id, tipo, { executarSeAusente: false });
    ok(res, { empresa, analise: resultado, pendenciasReferencias: cfg.pendenciasReferencias.map((m) => ({ chave: chaveReferenciaServico(m), descricao: m.descricao || 'Serviço sem descrição', nbs: m.nbs || '', valor: Number(m.valor) || 0 })) });
  } catch (e) { erro(res, e); }
});

/** Visão consolidada: apenas soma os resultados das Cadeias existentes. */
router.get('/empresas/:id/impacto-final-cbs', async (req, res) => {
  try {
    await atualizarConfiguracaoDeCalculo();
    const empresa = db.prepare('SELECT * FROM empresas WHERE id=?').get(req.params.id);
    if (!empresa) throw new Error('Empresa não encontrada');
    motorExec.reprocessarIncremental(empresa.id, { ano: 2027 });
    ok(res, { empresa, ...consolidacaoOficial.impactoFinal(empresa.id, { executarSeAusente: false }) });
  } catch (e) { erro(res, e); }
});
router.get('/empresas/:id/cenarios', async (req, res) => {
  try {
    await atualizarConfiguracaoDeCalculo();
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
    if (!empresa) throw new Error('Empresa não encontrada');
    motorExec.reprocessarIncremental(empresa.id, { ano: 2027 });
    const compras = consolidacaoOficial.cadeia(empresa.id, 'fornecedor', { executarSeAusente: false });
    const vendas = consolidacaoOficial.cadeia(empresa.id, 'cliente', { executarSeAusente: false });
    const c = compras.cenarios[0] || {}, v = vendas.cenarios[0] || {};
    const receitaLiquida = calc.r2((v.precoFinal || 0) - (v.cbs || 0) - (v.ibs || 0));
    const custo = Number(compras.totais.custoLiquido) || 0;
    const consolidado = [{
      ano: 2027, nota: 'Referência CBS materializada pelo motor técnico.',
      receitaBruta: v.precoFinal || 0, tributosSaida: calc.r2((v.cbs || 0) + (v.ibs || 0)), receitaLiquida,
      custoEfetivo: calc.r2(custo), creditos: c.credito || 0,
      resultadoBruto: calc.r2(receitaLiquida - custo),
      margemPerc: v.precoFinal ? calc.r4((receitaLiquida - custo) / v.precoFinal) : null,
      cargaEfetiva: v.baseEconomica ? calc.r4(((v.cbs || 0) + (v.ibs || 0)) / v.baseEconomica) : null,
    }];
    const base = consolidado[0] || {};
    const alvo = consolidado[consolidado.length - 1] || {};
    ok(res, {
      empresa, consolidado, compras: compras.cenarios, vendas: vendas.cenarios,
      totaisCompras: compras.totais, totaisVendas: vendas.totais,
      riscos: [...compras.riscos, ...vendas.riscos], fonte: 'motor_resultados',
      resumo: {
        variacaoResultado: calc.r2((alvo.resultadoBruto || 0) - (base.resultadoBruto || 0)),
        variacaoMargem: calc.r4((alvo.margemPerc || 0) - (base.margemPerc || 0)),
        variacaoCarga: calc.r4((alvo.cargaEfetiva || 0) - (base.cargaEfetiva || 0)),
      },
    });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/cenarios/salvar', (req, res) => {
  try {
    const r = db.prepare('INSERT INTO cenarios (empresa_id, nome, descricao, parametros, resultado) VALUES (?,?,?,?,?)')
      .run(req.params.id, req.body.nome || 'Cenário', req.body.descricao || '',
        JSON.stringify(req.body.parametros || {}), JSON.stringify(req.body.resultado || {}));
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/cenarios/salvos', (req, res) => ok(res, {
  cenarios: db.prepare('SELECT id, nome, descricao, criado_em FROM cenarios WHERE empresa_id = ? ORDER BY id DESC').all(req.params.id),
}));

router.get('/cenarios/:id', (req, res, next) => {
  // Rotas com nome fixo (/cenarios/dimensoes, /cenarios/comparar) chegariam
  // aqui e seriam tratadas como id. Só segue se for de fato um número.
  if (!/^\d+$/.test(req.params.id)) return next();
  const c = db.prepare('SELECT * FROM cenarios WHERE id = ?').get(req.params.id);
  if (!c) return erro(res, new Error('Cenário não encontrado'), 404);
  ok(res, { cenario: { ...c, parametros: JSON.parse(c.parametros || '{}'), resultado: JSON.parse(c.resultado || '{}') } });
});

// (exclusão de cenário definida na seção de Cenários, com proteção do cenário base)

// ===========================================================================
// MÓDULO 2 — PRECIFICAÇÃO
// ===========================================================================
// A precificação fiscal manual foi desativada. A tela consome a saída oficial
// materializada e a formação de custo explícita; não há mais simulador paralelo.
router.post('/precificacao/simular', (_req, res) => erro(res, new Error('A simulação manual foi desativada. Use a Formação de custo vinculada à saída oficial e peça qualquer cenário tributário ao motor central.'), 409));
router.post('/empresas/:id/precificacao', (_req, res) => erro(res, new Error('O cadastro manual de precificação foi desativado. Cadastre a Formação de custo e selecione explicitamente a saída oficial.'), 409));
router.post('/empresas/:id/precificacao/importar', (_req, res) => erro(res, new Error('A importação de simulações manuais foi desativada. A Precificação usa apenas saídas oficiais e formação de custo explícita.'), 409));
router.delete('/precificacao/:id', (_req, res) => erro(res, new Error('Itens legados não são mais fonte de precificação oficial.'), 409));

// ---------------------------------------------------------------------------
// PRECIFICAÇÃO INDEPENDENTE
// Base própria para clientes que contrataram somente Precificação e Margem.
// O upload é validado integralmente antes de qualquer escrita na base ativa.
// ---------------------------------------------------------------------------
const cabecalhoPrecificacao = (linha = {}) => Object.fromEntries(Object.entries(linha).map(([k, v]) => [String(k).trim().toLowerCase().replace(/[\s\-/]+/g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, ''), v]));
const linhasAba = (wb, nome) => XLSX.utils.sheet_to_json(wb.Sheets[nome] || {}, { defval: '' }).map(cabecalhoPrecificacao);
router.get('/empresas/:id/precificacao-independente/template', (_req, res) => {
  const wb = XLSX.utils.book_new();
  const adicionar = (nome, cabecalhos, exemplo) => {
    const ws = XLSX.utils.aoa_to_sheet([cabecalhos, exemplo]);
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }; ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(cabecalhos.length - 1)}2` };
    ws['!cols'] = cabecalhos.map((h) => ({ wch: Math.max(15, Math.min(30, h.length + 4)) })); XLSX.utils.book_append_sheet(wb, ws, nome);
  };
  adicionar('Produtos_Saida', ['codigo','descricao','ncm','unidade','quantidade_producao','valor_venda_atual','custo_direto','perfil_cliente'], ['PROD-001','Produto exemplo','85171300','UN',100,250,0,'b2b']);
  adicionar('Servicos_Saida', ['codigo','descricao','lc116','nbs','unidade','quantidade_producao','valor_venda_atual','custo_direto','perfil_cliente'], ['SERV-001','Serviço exemplo','1.07','115013000','H',10,500,0,'b2b']);
  adicionar('Composicao_Insumos', ['codigo_item_saida','codigo_componente','descricao','tipo_componente','ncm','nbs','lc116','cnpj_fornecedor','regime_fornecedor','quantidade','custo_unitario_bruto','perda_percentual'], ['PROD-001','INS-001','Insumo exemplo','produto','85171300','','','', 'lucro_real',2,50,0]);
  const arquivo = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="modelo-precificacao-margem.xlsx"'); res.send(arquivo);
});
router.get('/empresas/:id/precificacao-independente', (req, res) => {
  try { ok(res, { ...precificacaoIndependente.listarBase(Number(req.params.id)), modo: 'INDEPENDENTE', calculo_habilitado: false }); } catch (e) { erro(res, e); }
});
// Alias explícito consumido pela saída executiva: expõe somente a base própria
// do módulo, sem qualquer reclassificação ou cálculo tributário adicional.
router.get('/empresas/:id/precificacao-independente/base', (req, res) => {
  try { ok(res, precificacaoIndependente.listarBase(Number(req.params.id))); } catch (e) { erro(res, e); }
});
// Limpeza deliberadamente restrita a lotes sintéticos. É usada apenas para
// homologação/smoke test e jamais aceita um prefixo genérico que possa tocar
// a base comercial do cliente.
router.delete('/empresas/:id/precificacao-independente/testes/:prefixo', async (req, res) => {
  try {
    const empresaId = Number(req.params.id);
    const prefixo = String(req.params.prefixo || '');
    if (!/^SMOKE_PRICING_\d{8}_$/.test(prefixo)) throw new Error('Prefixo de teste inválido.');
    const like = `${prefixo}%`;
    const transacao = db.transaction(() => {
      const componentes = db.prepare('DELETE FROM pricing_components WHERE empresa_id=? AND (codigo_componente LIKE ? OR descricao LIKE ?)').run(empresaId, like, like).changes;
      const produtos = db.prepare('DELETE FROM pricing_products WHERE empresa_id=? AND (codigo LIKE ? OR descricao LIKE ?)').run(empresaId, like, like).changes;
      const servicos = db.prepare('DELETE FROM pricing_services WHERE empresa_id=? AND (codigo LIKE ? OR descricao LIKE ?)').run(empresaId, like, like).changes;
      const lotes = db.prepare('DELETE FROM pricing_import_batches WHERE empresa_id=? AND arquivo LIKE ?').run(empresaId, like).changes;
      return { componentes, produtos, servicos, lotes };
    });
    const removidos = transacao();
    await require('../services/operacaoCompartilhada').publicar();
    auditar(req, { empresaId, acao: 'Limpou dados sintéticos de Precificação', entidade: 'precificacao_independente', entidadeId: prefixo, depois: removidos });
    ok(res, { prefixo, removidos });
  } catch (e) { erro(res, e); }
});
router.get('/empresas/:id/precificacao-independente/formacao', (req, res) => {
  try { ok(res, { itens: precificacaoIndependente.calcularEmpresa(Number(req.params.id), { ano: Number(req.query.ano) || 2027 }), fonte_fiscal: 'motor.projetarItem', finalidade: 'FORMACAO_DE_CUSTO' }); } catch (e) { erro(res, e); }
});
router.post('/empresas/:id/precificacao-independente/simular', (req, res) => {
  try {
    const empresaId = Number(req.params.id); const opcoes = req.body || {};
    const itens = precificacaoIndependente.simularEmpresa(empresaId, opcoes);
    // A fotografia é produzida pela Precificação. Contratos e demais módulos
    // apenas a consomem, sem chamar o motor fiscal outra vez.
    const natureza = itens.some((x) => x.status === 'INCOMPLETO') ? 'INCOMPLETO' : (itens.some((x) => x.simulacao?.natureza === 'SIMULADO') ? 'SIMULADO' : 'CALCULADO');
    const reg = db.prepare('INSERT INTO pricing_simulacoes (empresa_id,modo,parametros_json,resultados_json,origem,natureza) VALUES (?,?,?,?,?,?)')
      .run(empresaId, opcoes.modo || 'REAJUSTE_LIVRE', JSON.stringify(opcoes), JSON.stringify(itens), 'MOTOR_FISCAL_OFICIAL', natureza);
    auditar(req, { empresaId, acao: 'Gerou fotografia oficial de Precificação', entidade: 'pricing_simulacao', entidadeId: reg.lastInsertRowid, depois: { modo: opcoes.modo || 'REAJUSTE_LIVRE', itens: itens.length, natureza } });
    ok(res, { itens, simulacao_id: reg.lastInsertRowid, fonte_fiscal: 'motor.projetarItem', finalidade: 'SIMULACAO_COMERCIAL' });
  } catch (e) { erro(res, e); }
});
router.post('/empresas/:id/precificacao-independente/saida-executiva', (req, res) => {
  try { ok(res, { relatorio: precificacaoExecutiva.montar(Number(req.params.id), req.body || {}) }); } catch (e) { erro(res, e); }
});
router.get('/empresas/:id/precificacao-independente/saida-executiva.pdf', (req, res) => {
  try { const relatorio=precificacaoExecutiva.montar(Number(req.params.id), { modo:req.query.modo, percentual_reajuste:req.query.percentual_reajuste, item_chaves:String(req.query.itens || '').split(',').filter(Boolean) }); res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="precificacao-margem-executivo.pdf"');precificacaoExecutiva.gerarPdf(relatorio,res); } catch(e){erro(res,e);}
});
router.post('/empresas/:id/precificacao-independente/importar', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error('Selecione a planilha XLSX da precificação.');
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const produtos = linhasAba(wb, 'Produtos_Saida'); const servicos = linhasAba(wb, 'Servicos_Saida'); const componentes = linhasAba(wb, 'Composicao_Insumos');
    if (!wb.Sheets.Produtos_Saida || !wb.Sheets.Servicos_Saida || !wb.Sheets.Composicao_Insumos) throw new Error('A planilha deve conter as abas Produtos_Saida, Servicos_Saida e Composicao_Insumos.');
    const validacao = precificacaoIndependente.validarPlanilha({ produtos, servicos, componentes });
    if (validacao.erros.length) return ok(res, { importado: false, erros: validacao.erros, mensagem: 'Nenhuma alteração foi feita na base ativa.' });
    const empresaId = Number(req.params.id); const inserirProduto = db.prepare(`INSERT INTO pricing_products (empresa_id,codigo,descricao,natureza_item,ncm,unidade,quantidade_producao,valor_venda_atual,custo_direto,perfil_cliente,origem) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const inserirServico = db.prepare(`INSERT INTO pricing_services (empresa_id,codigo,descricao,lc116,nbs,unidade,quantidade_producao,valor_venda_atual,custo_direto,perfil_cliente,origem) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const inserirComp = db.prepare(`INSERT INTO pricing_components (empresa_id,produto_saida_id,servico_saida_id,codigo_componente,descricao,tipo_componente,ncm,nbs,lc116,cnpj_fornecedor,regime_fornecedor,quantidade,custo_unitario_bruto,perda_percentual,origem) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const transacao = db.transaction(() => {
      db.prepare('DELETE FROM pricing_products WHERE empresa_id=?').run(empresaId);
      db.prepare('DELETE FROM pricing_services WHERE empresa_id=?').run(empresaId);
      const produtosIds = new Map(), servicosIds = new Map();
      produtos.forEach((x) => { const r = inserirProduto.run(empresaId,x.codigo,x.descricao,'produto',x.ncm || '',x.unidade || '',Number(x.quantidade_producao),Number(x.valor_venda_atual),Number(x.custo_direto) || 0,x.perfil_cliente || '', 'IMPORTACAO'); produtosIds.set(x.codigo,r.lastInsertRowid); });
      servicos.forEach((x) => { const r = inserirServico.run(empresaId,x.codigo,x.descricao,x.lc116 || '',x.nbs || '',x.unidade || '',Number(x.quantidade_producao),Number(x.valor_venda_atual),Number(x.custo_direto) || 0,x.perfil_cliente || '', 'IMPORTACAO'); servicosIds.set(x.codigo,r.lastInsertRowid); });
      componentes.forEach((x) => { const codigo = String(x.codigo_item_saida).trim(); inserirComp.run(empresaId,produtosIds.get(codigo) || null,servicosIds.get(codigo) || null,x.codigo_componente,x.descricao || x.codigo_componente,String(x.tipo_componente).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ /g,'_'),x.ncm || '',x.nbs || '',x.lc116 || '',String(x.cnpj_fornecedor || '').replace(/\D/g,''),String(x.regime_fornecedor || '').trim().toLowerCase().replace(/ /g,'_'),Number(x.quantidade),Number(x.custo_unitario_bruto),Number(x.perda_percentual) || 0,'IMPORTACAO'); });
      db.prepare('INSERT INTO pricing_import_batches (empresa_id,arquivo,status,resumo) VALUES (?,?,?,?)').run(empresaId,req.file.originalname,'IMPORTADO',JSON.stringify({ produtos: produtos.length, servicos: servicos.length, componentes: componentes.length }));
    }); transacao(); await require('../services/operacaoCompartilhada').publicar(); auditar(req, { empresaId, acao: 'Importou base independente de Precificação', entidade: 'precificacao_independente', entidadeId: req.file.originalname, depois: { produtos: produtos.length, servicos: servicos.length, componentes: componentes.length } });
    ok(res, { importado: true, produtos: produtos.length, servicos: servicos.length, componentes: componentes.length });
  } catch (e) { erro(res, e); }
});

// ---------------------------------------------------------------------------
// BASE DE FORMAÇÃO DE CUSTO
// Esta camada aloca insumos e créditos já calculados pelo motor. Ela nunca
// recalcula CBS, classificação ou base econômica.
// ---------------------------------------------------------------------------
function resumoFormacaoCusto(empresaId, item) {
  const componentes = db.prepare(`SELECT c.*, m.descricao AS movimento_descricao, m.codigo_produto,
    r.base_economica, r.custo_liquido, r.ibs, r.credito_ibs, r.cbs, r.credito_cbs, r.tipo_credito, r.modalidade_credito,
    r.status_credito_determinacao, r.natureza
    FROM formacao_custo_componentes c
    LEFT JOIN movimentos m ON m.id=c.movimento_id
    LEFT JOIN motor_resultados r ON r.movimento_id=c.movimento_id AND r.empresa_id=?
    WHERE c.item_formacao_id=? ORDER BY c.id`).all(empresaId, item.id);
  let creditoTotal = 0, direto = 0, rateavel = 0, naoAlocado = 0, custoBrutoAlocado = 0;
  for (const c of componentes) {
    const credito = Number(c.credito_cbs) || 0;
    creditoTotal += credito;
    // O custo oficial já pode estar líquido de crédito. Para a formação, ele
    // volta ao bruto e só reduz a parcela de crédito explicitamente alocada.
    const custoBruto = (Number(c.custo_liquido) || 0) + credito + (Number(c.credito_ibs) || 0);
    if (c.status_alocacao_credito === 'DIRETO') {
      direto += credito;
      custoBrutoAlocado += custoBruto;
    } else if (c.status_alocacao_credito === 'RATEAVEL' && c.criterio_rateio && Number(c.percentual_rateio) > 0) {
      const fracao = Math.min(1, Number(c.percentual_rateio));
      rateavel += credito * fracao;
      // A parcela não distribuída é crédito da empresa, não do item.
      naoAlocado += credito * (1 - fracao);
      custoBrutoAlocado += custoBruto * fracao;
    } else {
      naoAlocado += credito;
      // Sem alocação de crédito, o insumo pode compor custo bruto quando a
      // relação econômica for explícita, mas nenhum crédito reduz o item.
      if (c.relacionamento !== 'NAO_RELACIONADA') custoBrutoAlocado += custoBruto;
    }
  }
  const creditoReconciliado = Math.abs(creditoTotal - (direto + rateavel + naoAlocado)) <= 0.01;
  const completo = Boolean(item.movimento_saida_id) && componentes.length > 0 && creditoReconciliado && componentes.every((c) => c.relacionamento !== 'NAO_RELACIONADA'
    && (c.status_alocacao_credito !== 'RATEAVEL' || (c.criterio_rateio && Number(c.percentual_rateio) > 0)));
  return {
    ...item, componentes,
    credito_cbs_total: Math.round(creditoTotal * 100) / 100,
    credito_cbs_direto: Math.round(direto * 100) / 100,
    credito_cbs_rateado: Math.round(rateavel * 100) / 100,
    credito_cbs_nao_alocado: Math.round(naoAlocado * 100) / 100,
    credito_cbs_precificavel: Math.round((direto + rateavel) * 100) / 100,
    custo_economico_bruto_alocado: Math.round(custoBrutoAlocado * 100) / 100,
    reconciliacao_credito: creditoReconciliado ? 'RECONCILIADO' : 'DIVERGENTE',
    status_formacao_custo: completo ? 'COMPLETO' : (creditoReconciliado ? 'INCOMPLETO' : 'DIVERGENTE'),
  };
}

router.get('/empresas/:id/precificacao', (req, res) => {
  try {
    const itens = db.prepare('SELECT * FROM formacao_custo_itens WHERE empresa_id=? AND ativo=1 ORDER BY descricao,id').all(req.params.id);
    const porMovimento = db.prepare(`SELECT m.id AS movimento_id,m.descricao,m.codigo_produto,m.ncm,m.nbs,
      r.preco_atual,r.base_economica,r.cbs,r.ibs,r.credito_cbs,r.preco_projetado,
      r.tratamento,r.cst,r.cclasstrib,r.natureza
      FROM movimentos m JOIN motor_resultados r ON r.movimento_id=m.id AND r.empresa_id=m.empresa_id
      WHERE m.empresa_id=? AND m.id=?`);
    const resultado = itens.map((item) => {
      const formacao = resumoFormacaoCusto(req.params.id, item);
      const saida = item.movimento_saida_id ? porMovimento.get(req.params.id, item.movimento_saida_id) : null;
      return prec.analisarItemOficial({ item, saida, formacao, despesasVariaveis: Number(item.despesas_variaveis) || 0 });
    });
    ok(res, { itens: resultado, fonte: 'motor_resultados', legado: db.prepare('SELECT COUNT(*) AS total FROM itens_precificacao WHERE empresa_id=?').get(req.params.id).total });
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/formacao-custo', (req, res) => {
  try {
    const itens = db.prepare('SELECT * FROM formacao_custo_itens WHERE empresa_id=? ORDER BY descricao,id').all(req.params.id);
    const entradasDisponiveis = db.prepare(`SELECT m.id, m.codigo_produto, m.descricao, m.ncm, m.nbs, m.valor,
      r.base_economica, r.credito_cbs, r.tipo_credito, r.modalidade_credito, r.status_credito_determinacao, r.natureza
      FROM movimentos m LEFT JOIN motor_resultados r ON r.movimento_id=m.id AND r.empresa_id=m.empresa_id
      WHERE m.empresa_id=? AND (m.tipo='fornecedor' OR m.sentido='entrada')
      ORDER BY m.descricao,m.id LIMIT 500`).all(req.params.id);
    const saidasDisponiveis = db.prepare(`SELECT m.id,m.codigo_produto,m.descricao,m.ncm,m.nbs,m.valor,
      r.preco_atual,r.base_economica,r.cbs,r.credito_cbs,r.preco_projetado,r.natureza
      FROM movimentos m LEFT JOIN motor_resultados r ON r.movimento_id=m.id AND r.empresa_id=m.empresa_id
      WHERE m.empresa_id=? AND (m.tipo='cliente' OR m.sentido='saida') ORDER BY m.descricao,m.id LIMIT 500`).all(req.params.id);
    ok(res, { itens: itens.map((item) => resumoFormacaoCusto(req.params.id, item)),
      entradasDisponiveis, saidasDisponiveis,
      criterios_rateio: ['faturamento', 'custo', 'quantidade', 'volume', 'horas', 'centro_custo', 'outro_parametrizado'],
      relacionamentos: ['DIRETA', 'COMPOSICAO', 'RATEIO', 'NAO_RELACIONADA'] });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/formacao-custo', (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.descricao || '').trim()) throw new Error('Informe a descrição do produto ou serviço de saída.');
    const r = db.prepare(`INSERT INTO formacao_custo_itens
      (empresa_id,codigo,descricao,tipo,sku,gtin,ncm,nbs,unidade,centro_custo,despesas_variaveis,movimento_saida_id,ativo,status_formacao_custo,origem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.params.id, b.codigo || '', String(b.descricao).trim(),
      b.tipo === 'servico' ? 'servico' : 'mercadoria', b.sku || '', b.gtin || '', b.ncm || '', b.nbs || '', b.unidade || '',
      b.centro_custo || '', Number(b.despesasVariaveis) || 0, b.movimentoSaidaId || null, b.ativo === false ? 0 : 1, 'INCOMPLETO', 'MANUAL');
    registrar(req.params.id, req, 'criar', 'formacao_custo_item', r.lastInsertRowid, '', JSON.stringify(b));
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.post('/formacao-custo/:id/componentes', (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM formacao_custo_itens WHERE id=?').get(req.params.id);
    if (!item) throw new Error('Item de formação de custo não encontrado.');
    const b = req.body || {};
    const rel = ['DIRETA', 'COMPOSICAO', 'RATEIO', 'NAO_RELACIONADA'].includes(b.relacionamento) ? b.relacionamento : 'NAO_RELACIONADA';
    const status = ['DIRETO', 'RATEAVEL', 'NAO_ALOCADO'].includes(b.statusAlocacaoCredito) ? b.statusAlocacaoCredito : 'NAO_ALOCADO';
    if (status === 'RATEAVEL' && (!b.criterioRateio || !(Number(b.percentualRateio) > 0))) throw new Error('Crédito rateável exige critério e percentual de rateio explícitos.');
    const r = db.prepare(`INSERT INTO formacao_custo_componentes
      (item_formacao_id,movimento_id,codigo_origem,descricao_origem,relacionamento,criterio_rateio,percentual_rateio,quantidade,unidade,status_alocacao_credito,observacoes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(item.id, b.movimentoId || null, b.codigoOrigem || '', b.descricaoOrigem || '', rel,
      b.criterioRateio || null, Number(b.percentualRateio) || null, Number(b.quantidade) || null, b.unidade || '', status, b.observacoes || '');
    db.prepare("UPDATE formacao_custo_itens SET status_formacao_custo='INCOMPLETO', atualizado_em=datetime('now','localtime') WHERE id=?").run(item.id);
    registrar(item.empresa_id, req, 'criar', 'formacao_custo_componente', r.lastInsertRowid, '', JSON.stringify(b));
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.delete('/formacao-custo/componentes/:id', (req, res) => {
  try {
    const c = db.prepare(`SELECT c.*, i.empresa_id, c.item_formacao_id FROM formacao_custo_componentes c
      JOIN formacao_custo_itens i ON i.id=c.item_formacao_id WHERE c.id=?`).get(req.params.id);
    if (!c) throw new Error('Componente não encontrado.');
    db.prepare('DELETE FROM formacao_custo_componentes WHERE id=?').run(c.id);
    db.prepare("UPDATE formacao_custo_itens SET status_formacao_custo='INCOMPLETO', atualizado_em=datetime('now','localtime') WHERE id=?").run(c.item_formacao_id);
    registrar(c.empresa_id, req, 'excluir', 'formacao_custo_componente', c.id, JSON.stringify(c), '');
    ok(res, {});
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// MÓDULO 3 — CONTRATOS
// ===========================================================================
router.get('/empresas/:id/contratos', (req, res) => {
  const contratos = db.prepare('SELECT * FROM contratos WHERE empresa_id = ? ORDER BY id DESC').all(req.params.id);
  const check = db.prepare('SELECT * FROM contrato_checklist WHERE contrato_id = ?');
  ok(res, { contratos: contratos.map((c) => ({ ...c, checklist: check.all(c.id) })), clausulas: CLAUSULAS });
});

// Vínculo entre a revisão contratual e o diagnóstico da contraparte.
router.get('/contratos/:id/impacto-diagnostico', async (req, res) => {
  try {
    const contrato = await contratoPermitido(req, req.params.id);
    const cnpj = imp.soDigitos(contrato.cnpj_contraparte || '');
    const execucao = db.prepare('SELECT id FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(contrato.empresa_id);
    if (!cnpj) return ok(res, { encontrado: false, motivo: 'Informe o CNPJ da contraparte para relacionar o contrato ao diagnóstico.' });
    if (!execucao) return ok(res, { encontrado: false, motivo: 'Execute o motor do diagnóstico para calcular o impacto desta contraparte.' });
    const impacto = db.prepare(`SELECT COUNT(DISTINCT m.id) movimentos, COALESCE(SUM(m.valor),0) valor,
      COALESCE(SUM(r.ibs),0) ibs, COALESCE(SUM(r.cbs),0) cbs,
      COALESCE(SUM(r.credito_ibs+r.credito_cbs),0) credito, COALESCE(SUM(r.custo_liquido),0) custo_liquido
      FROM movimentos m LEFT JOIN motor_resultados r ON r.movimento_id=m.id AND r.execucao_id=?
      WHERE m.empresa_id=? AND replace(replace(replace(m.inscr_federal,'.',''),'/',''),'-','')=?`).get(execucao.id, contrato.empresa_id, cnpj);
    if (!impacto.movimentos) return ok(res, { encontrado: false, motivo: 'Não há movimentação importada para esta contraparte no diagnóstico.' });
    ok(res, { encontrado: true, impacto });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/contratos', (req, res) => {
  try {
    const b = req.body;
    const r = db.prepare(`INSERT INTO contratos (empresa_id, tipo, contraparte, cnpj_contraparte,
      regime_contraparte, objeto, valor, vigencia_inicio, vigencia_fim, reajuste, preco_com_tributo, status, risco, parecer)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.params.id, b.tipo || 'compra', b.contraparte || '',
      imp.soDigitos(b.cnpj_contraparte), b.regime_contraparte || 'lucro_real', b.objeto || '', +b.valor || 0,
      b.vigencia_inicio || '', b.vigencia_fim || '', b.reajuste || '', b.preco_com_tributo ? 1 : 0,
      b.status || 'pendente', b.risco || 'nao_avaliado', b.parecer || '');
    // pré-carrega o checklist com as cláusulas aplicáveis ao tipo
    const ins = db.prepare(`INSERT INTO contrato_checklist (contrato_id, clausula_id, situacao) VALUES (?,?, 'ausente')`);
    CLAUSULAS.filter((c) => c.aplicacao.includes(b.tipo || 'compra')).forEach((c) => ins.run(r.lastInsertRowid, c.id));
    auditar(req, { empresaId: req.params.id, acao: 'Criou contrato para revisão', entidade: 'contrato', entidadeId: r.lastInsertRowid, depois: { contraparte: b.contraparte || '', tipo: b.tipo || 'compra' } });
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.put('/contratos/:id', async (req, res) => {
  try {
    const b = req.body;
    const antes = await contratoPermitido(req, req.params.id);
    db.prepare(`UPDATE contratos SET tipo=?, contraparte=?, cnpj_contraparte=?, regime_contraparte=?, objeto=?,
      valor=?, vigencia_inicio=?, vigencia_fim=?, reajuste=?, preco_com_tributo=?, status=?, risco=?, parecer=? WHERE id=?`)
      .run(b.tipo, b.contraparte, imp.soDigitos(b.cnpj_contraparte), b.regime_contraparte, b.objeto, +b.valor || 0,
        b.vigencia_inicio || '', b.vigencia_fim || '', b.reajuste || '', b.preco_com_tributo ? 1 : 0,
        b.status, b.risco, b.parecer || '', req.params.id);
    auditar(req, { empresaId: antes.empresa_id, acao: 'Atualizou contrato', entidade: 'contrato', entidadeId: req.params.id, antes: { status: antes.status, risco: antes.risco }, depois: { status: b.status, risco: b.risco } });
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.put('/contratos/:id/checklist', async (req, res) => {
  try {
    const contrato = await contratoPermitido(req, req.params.id);
    const up = db.prepare('UPDATE contrato_checklist SET situacao=?, observacao=? WHERE contrato_id=? AND clausula_id=?');
    const ins = db.prepare('INSERT INTO contrato_checklist (contrato_id, clausula_id, situacao, observacao) VALUES (?,?,?,?)');
    db.transaction(() => {
      for (const item of req.body.itens || []) {
        const r = up.run(item.situacao, item.observacao || '', req.params.id, item.clausula_id);
        if (!r.changes) ins.run(req.params.id, item.clausula_id, item.situacao, item.observacao || '');
      }
    })();
    // recalcula o risco
    const itens = db.prepare('SELECT * FROM contrato_checklist WHERE contrato_id = ?').all(req.params.id);
    const criticasAusentes = itens.filter((i) => i.situacao === 'ausente' &&
      (CLAUSULAS.find((c) => c.id === i.clausula_id) || {}).risco === 'alto').length;
    const risco = criticasAusentes >= 3 ? 'alto' : criticasAusentes >= 1 ? 'medio' : 'baixo';
    db.prepare('UPDATE contratos SET risco = ?, status = ? WHERE id = ?').run(risco, 'em_revisao', req.params.id);
    auditar(req, { empresaId: contrato.empresa_id, acao: 'Atualizou checklist contratual', entidade: 'contrato', entidadeId: req.params.id, depois: { risco, criticas_ausentes: criticasAusentes } });
    ok(res, { risco, criticasAusentes });
  } catch (e) { erro(res, e); }
});

router.delete('/contratos/:id', async (req, res) => { try { const contrato = await contratoPermitido(req, req.params.id); db.prepare('DELETE FROM contratos WHERE id=?').run(req.params.id); auditar(req, { empresaId: contrato.empresa_id, acao: 'Excluiu contrato', entidade: 'contrato', entidadeId: req.params.id, antes: { contraparte: contrato.contraparte } }); ok(res, {}); } catch (e) { erro(res, e); } });

// ---------------------------------------------------------------------------
// CONTRATOS — ENTREGA 1: acervo original, extração determinística e riscos.
// Não substitui a revisão existente nem cria pareceres/cláusulas finais.
// ---------------------------------------------------------------------------
router.post('/empresas/:id/contratos/entrega1', (req, res) => {
  try {
    const b = req.body || {}; const empresaId = Number(req.params.id);
    const tipo = String(b.tipo_contrato || b.tipo || 'OUTRO').toLowerCase();
    const reg = db.prepare(`INSERT INTO contratos (empresa_id,tipo,contraparte,cnpj_contraparte,regime_contraparte,objeto,valor,vigencia_inicio,vigencia_fim,reajuste,status,risco,parecer,nome,moeda,periodicidade_reajuste,tipo_relacao,renovacao,observacoes,arquivo_origem,status_analise)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      empresaId, tipo, b.contraparte || '', imp.soDigitos(b.cnpj_contraparte || ''), b.regime_contraparte || '', b.objeto || '',
      Number(b.valor) || 0, b.data_inicio || b.vigencia_inicio || '', b.data_fim || b.vigencia_fim || '', b.reajuste || '',
      'pendente', 'nao_avaliado', '', b.nome || b.objeto || 'Contrato sem título', b.moeda || 'BRL', b.periodicidade_reajuste || '',
      b.tipo_relacao || '', b.renovacao || '', b.observacoes || '', '', 'NAO_INICIADA');
    auditar(req, { empresaId, acao: 'Criou contrato para triagem documental', entidade: 'contrato', entidadeId: reg.lastInsertRowid, depois: { nome: b.nome || '', tipo } });
    ok(res, { contrato_id: reg.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.post('/contratos/:id/documentos', upload.single('arquivo'), async (req, res) => {
  try {
    const contrato = await contratoPermitido(req, req.params.id);
    const textoManual = String(req.body?.texto || '').trim();
    if (!req.file && !textoManual) throw new Error('Envie um arquivo PDF, DOCX ou TXT, ou informe o texto do contrato.');
    const arquivo = req.file || { originalname: req.body?.nome || 'texto-manual.txt', mimetype: 'text/plain', buffer: Buffer.from(textoManual, 'utf8') };
    const extracao = await contratosEntrega1.extrairArquivo(arquivo, {
      extrairPdf: ia.config().ativo ? async (f) => (await ia.extrairTexto(f)).texto : null,
    });
    const conteudo = Buffer.from(arquivo.buffer); const digesto = contratosEntrega1.hash(conteudo);
    const inserirDoc = db.prepare(`INSERT INTO contrato_documentos (empresa_id,contrato_id,nome_original,mime_type,tipo_origem,conteudo_original,hash_original,tamanho_bytes,texto_extraido,status_extracao,observacao_extracao)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const inserirClausula = db.prepare(`INSERT INTO contrato_clausulas_extraidas (documento_id,contrato_id,ordem,texto_original,localizacao,pagina,secao,tema,confianca,natureza) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const inserirRisco = db.prepare(`INSERT INTO contrato_riscos_iniciais (documento_id,contrato_id,clausula_id,codigo,risco,evidencia,impacto_potencial,nivel,fundamento,natureza,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    let documentoId; let resultado = { clausulas: [], riscos: [] };
    db.transaction(() => {
      const d = inserirDoc.run(contrato.empresa_id, contrato.id, arquivo.originalname, arquivo.mimetype || 'text/plain', extracao.tipo, conteudo, digesto, conteudo.length, extracao.texto || '', extracao.status, extracao.observacao || '');
      documentoId = d.lastInsertRowid;
      if (extracao.status === 'CONCLUIDA') {
        resultado = contratosEntrega1.analisarTexto(extracao.texto);
        const clausulaPorOrdem = new Map();
        for (const c of resultado.clausulas) {
          const r = inserirClausula.run(documentoId, contrato.id, c.ordem, c.texto_original, c.localizacao, c.pagina || null, c.secao || null, c.tema, c.confianca, c.natureza);
          if (!clausulaPorOrdem.has(c.ordem)) clausulaPorOrdem.set(c.ordem, r.lastInsertRowid);
        }
        for (const r of resultado.riscos) inserirRisco.run(documentoId, contrato.id, r.clausula_ordem ? clausulaPorOrdem.get(r.clausula_ordem) || null : null, r.codigo, r.risco, r.evidencia, r.impacto_potencial, r.nivel, r.fundamento, r.natureza, r.status);
      }
      db.prepare('UPDATE contratos SET arquivo_origem=?, status_analise=?, risco=? WHERE id=?').run(arquivo.originalname, extracao.status === 'CONCLUIDA' ? 'TRIAGEM_INICIAL_CONCLUIDA' : extracao.status, resultado.riscos.some((r) => r.nivel === 'alto') ? 'alto' : resultado.riscos.length ? 'medio' : 'nao_avaliado', contrato.id);
    })();
    auditar(req, { empresaId: contrato.empresa_id, acao: 'Preservou documento e executou triagem contratual inicial', entidade: 'contrato_documento', entidadeId: documentoId, depois: { arquivo: arquivo.originalname, status_extracao: extracao.status, clausulas: resultado.clausulas.length, riscos: resultado.riscos.length } });
    ok(res, { documento_id: documentoId, status_extracao: extracao.status, observacao: extracao.observacao, clausulas: resultado.clausulas.length, riscos: resultado.riscos.length });
  } catch (e) { erro(res, e); }
});

router.get('/contratos/:id/memoria-inicial', async (req, res) => {
  try {
    const contrato = await contratoPermitido(req, req.params.id);
    const documentos = db.prepare('SELECT id,nome_original,mime_type,tipo_origem,hash_original,tamanho_bytes,status_extracao,observacao_extracao,criado_em FROM contrato_documentos WHERE contrato_id=? ORDER BY id DESC').all(contrato.id);
    const clausulas = db.prepare('SELECT * FROM contrato_clausulas_extraidas WHERE contrato_id=? ORDER BY documento_id,ordem,id').all(contrato.id);
    const riscos = db.prepare('SELECT * FROM contrato_riscos_iniciais WHERE contrato_id=? ORDER BY documento_id,id').all(contrato.id);
    const vinculos = db.prepare('SELECT * FROM contrato_precificacao_vinculos WHERE contrato_id=? ORDER BY id').all(contrato.id);
    const recomendacoes = db.prepare('SELECT * FROM contrato_recomendacoes WHERE contrato_id=? ORDER BY CASE prioridade WHEN \'ALTA\' THEN 1 WHEN \'MEDIA\' THEN 2 ELSE 3 END,id').all(contrato.id);
    const sugestoes = db.prepare('SELECT * FROM contrato_sugestoes_clausulas WHERE contrato_id=? ORDER BY id').all(contrato.id);
    ok(res, { contrato, documentos, clausulas, riscos, vinculos, recomendacoes, sugestoes, natureza_documento: 'EXTRAIDO', natureza_risco: 'INTERPRETADO', observacao: 'Triagem e recomendações rastreáveis: rascunhos não constituem parecer ou cláusula final.' });
  } catch (e) { erro(res, e); }
});

router.get('/contrato-documentos/:id/original', async (req, res) => {
  try {
    const documento = db.prepare('SELECT * FROM contrato_documentos WHERE id=?').get(req.params.id);
    if (!documento) throw new Error('Documento não encontrado.');
    await garantirEmpresaPermitida(req, documento.empresa_id);
    res.setHeader('Content-Type', documento.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(documento.nome_original).replace(/[\r\n"]/g, '_')}"`);
    res.send(documento.conteudo_original);
  } catch (e) { erro(res, e); }
});

router.post('/contratos/:id/vinculos-precificacao', async (req, res) => {
  try {
    const contrato = await contratoPermitido(req, req.params.id); const b = req.body || {};
    const tipo = String(b.tipo_item || ''); const itemId = Number(b.item_precificacao_id);
    if (!['produto', 'servico'].includes(tipo) || !itemId) throw new Error('Informe explicitamente produto ou serviço e o item de Precificação.');
    const tabela = tipo === 'produto' ? 'pricing_products' : 'pricing_services';
    const item = db.prepare(`SELECT id,descricao FROM ${tabela} WHERE id=? AND empresa_id=?`).get(itemId, contrato.empresa_id);
    if (!item) throw new Error('Item de Precificação não encontrado nesta empresa. Nenhum vínculo automático é permitido.');
    const simulacaoId = b.pricing_simulacao_id == null || b.pricing_simulacao_id === '' ? null : Number(b.pricing_simulacao_id);
    if (simulacaoId && !db.prepare('SELECT id FROM pricing_simulacoes WHERE id=? AND empresa_id=?').get(simulacaoId, contrato.empresa_id)) throw new Error('A fotografia de Precificação informada não pertence a esta empresa.');
    db.prepare(`INSERT INTO contrato_precificacao_vinculos (contrato_id,tipo_item,item_precificacao_id,pricing_simulacao_id,status,origem,observacoes,confirmado_em) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(contrato_id,tipo_item,item_precificacao_id) DO UPDATE SET pricing_simulacao_id=excluded.pricing_simulacao_id,status=excluded.status,observacoes=excluded.observacoes,confirmado_em=excluded.confirmado_em`).run(contrato.id, tipo, itemId, simulacaoId, b.status === 'CONFIRMADO' ? 'CONFIRMADO' : 'PENDENTE_CONFIRMACAO', 'EXPLICITO', b.observacoes || '', b.status === 'CONFIRMADO' ? new Date().toISOString() : null);
    auditar(req, { empresaId: contrato.empresa_id, acao: 'Criou vínculo explícito entre contrato e Precificação', entidade: 'contrato_precificacao_vinculo', entidadeId: contrato.id, depois: { tipo, item_id: itemId, simulacao_id: simulacaoId, status: b.status === 'CONFIRMADO' ? 'CONFIRMADO' : 'PENDENTE_CONFIRMACAO' } });
    ok(res, { item, mensagem: 'Vínculo econômico explícito registrado; nenhuma classificação fiscal foi inferida.' });
  } catch (e) { erro(res, e); }
});

router.post('/contratos/:id/entrega2/gerar', async (req, res) => {
  try {
    const contrato = await contratoPermitido(req, req.params.id);
    const clausulas = db.prepare('SELECT * FROM contrato_clausulas_extraidas WHERE contrato_id=? ORDER BY id').all(contrato.id);
    const riscos = db.prepare('SELECT * FROM contrato_riscos_iniciais WHERE contrato_id=? AND status<>? ORDER BY id').all(contrato.id, 'ARQUIVADO');
    const vinculos = db.prepare("SELECT * FROM contrato_precificacao_vinculos WHERE contrato_id=? AND status='CONFIRMADO' AND pricing_simulacao_id IS NOT NULL").all(contrato.id);
    const itensPrecificacao = [];
    for (const v of vinculos) {
      const snap = db.prepare('SELECT * FROM pricing_simulacoes WHERE id=? AND empresa_id=?').get(v.pricing_simulacao_id, contrato.empresa_id);
      if (!snap) continue;
      const itens = JSON.parse(snap.resultados_json || '[]');
      const item = itens.find((x) => x?.item?.natureza_item === v.tipo_item && Number(x?.item?.id) === Number(v.item_precificacao_id));
      if (item) itensPrecificacao.push(item);
    }
    const gerado = contratosEntrega2.gerar({ riscos, clausulas, itensPrecificacao });
    const insRec = db.prepare(`INSERT INTO contrato_recomendacoes (contrato_id,risco_id,clausula_id,recomendacao,evidencia,impacto_potencial,prioridade,fundamento,natureza,origem) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const insSug = db.prepare(`INSERT INTO contrato_sugestoes_clausulas (contrato_id,risco_id,clausula_original,sugestao_redacao,motivo,impacto_esperado,fundamento,natureza,status) VALUES (?,?,?,?,?,?,?,?,?)`);
    db.transaction(() => {
      db.prepare("DELETE FROM contrato_recomendacoes WHERE contrato_id=? AND origem IN ('TRIAGEM_CONTRATUAL','PRECIFICACAO_VINCULO_EXPLICITO')").run(contrato.id);
      db.prepare("DELETE FROM contrato_sugestoes_clausulas WHERE contrato_id=? AND status='RASCUNHO'").run(contrato.id);
      for (const r of gerado.recomendacoes) insRec.run(contrato.id, r.risco_id || null, r.clausula_id || null, r.recomendacao, r.evidencia, r.impacto_potencial, r.prioridade, r.fundamento, r.natureza, r.origem || 'TRIAGEM_CONTRATUAL');
      for (const s of gerado.sugestoes) insSug.run(contrato.id, s.risco_id || null, s.clausula_original || null, s.sugestao_redacao, s.motivo, s.impacto_esperado, s.fundamento, s.natureza, s.status);
    })();
    auditar(req, { empresaId: contrato.empresa_id, acao: 'Gerou recomendações e rascunhos contratuais', entidade: 'contrato', entidadeId: contrato.id, depois: { recomendacoes: gerado.recomendacoes.length, sugestoes: gerado.sugestoes.length, vinculos_economicos_lidos: itensPrecificacao.length } });
    ok(res, { recomendacoes: gerado.recomendacoes.length, sugestoes: gerado.sugestoes.length, vinculos_economicos_lidos: itensPrecificacao.length, aviso: 'Rascunhos sugeridos exigem revisão jurídica; o documento original não foi alterado.' });
  } catch (e) { erro(res, e); }
});

function carregarRelatorioContratual(contrato) {
  const documentos = db.prepare('SELECT id,nome_original,mime_type,tipo_origem,hash_original,tamanho_bytes,status_extracao,observacao_extracao,criado_em FROM contrato_documentos WHERE contrato_id=? ORDER BY id DESC').all(contrato.id);
  const clausulas = db.prepare('SELECT * FROM contrato_clausulas_extraidas WHERE contrato_id=? ORDER BY documento_id,ordem,id').all(contrato.id);
  const riscos = db.prepare('SELECT * FROM contrato_riscos_iniciais WHERE contrato_id=? AND status<>? ORDER BY id').all(contrato.id, 'ARQUIVADO');
  const recomendacoes = db.prepare('SELECT * FROM contrato_recomendacoes WHERE contrato_id=? ORDER BY CASE prioridade WHEN \'ALTA\' THEN 1 WHEN \'MEDIA\' THEN 2 ELSE 3 END,id').all(contrato.id);
  const sugestoes = db.prepare('SELECT * FROM contrato_sugestoes_clausulas WHERE contrato_id=? ORDER BY id').all(contrato.id);
  const vinculos = db.prepare("SELECT * FROM contrato_precificacao_vinculos WHERE contrato_id=? AND status='CONFIRMADO' AND pricing_simulacao_id IS NOT NULL").all(contrato.id);
  const impactosEconomicos = [];
  for (const v of vinculos) {
    const snap = db.prepare('SELECT resultados_json FROM pricing_simulacoes WHERE id=? AND empresa_id=?').get(v.pricing_simulacao_id, contrato.empresa_id);
    if (!snap) continue;
    const item = JSON.parse(snap.resultados_json || '[]').find((x) => x?.item?.natureza_item === v.tipo_item && Number(x?.item?.id) === Number(v.item_precificacao_id));
    if (item) impactosEconomicos.push(contratosExecutivo.impactoEconomico(item, v));
  }
  return contratosExecutivo.montarContrato({ contrato, documentos, clausulas, riscos, recomendacoes, sugestoes, impactosEconomicos });
}

router.put('/contratos/:id/natureza', async (req, res) => {
  try {
    const contrato = await contratoPermitido(req, req.params.id); const natureza = String(req.body?.natureza_contrato || 'INDETERMINADO').toUpperCase();
    const evidencia = String(req.body?.evidencia_natureza || '').trim(); const origem = String(req.body?.origem_natureza || '').trim();
    if (!['CONTRATO_ADMINISTRATIVO', 'CONTRATO_PRIVADO', 'INDETERMINADO'].includes(natureza)) throw new Error('Natureza contratual inválida.');
    if (natureza !== 'INDETERMINADO' && (!evidencia || !origem)) throw new Error('Para classificar como administrativo ou privado, informe a origem e a evidência expressa do documento ou cadastro.');
    db.prepare('UPDATE contratos SET natureza_contrato=?, natureza_contrato_origem=?, natureza_contrato_evidencia=? WHERE id=?').run(natureza, natureza === 'INDETERMINADO' ? null : origem, natureza === 'INDETERMINADO' ? null : evidencia, contrato.id);
    auditar(req, { empresaId: contrato.empresa_id, acao: 'Definiu natureza do contrato', entidade: 'contrato', entidadeId: contrato.id, depois: { natureza_contrato: natureza, origem: natureza === 'INDETERMINADO' ? null : origem, evidencia: natureza === 'INDETERMINADO' ? null : evidencia } });
    ok(res, { natureza_contrato: natureza });
  } catch (e) { erro(res, e); }
});

router.get('/contratos/:id/saida-executiva', async (req, res) => {
  try { ok(res, { relatorio: carregarRelatorioContratual(await contratoPermitido(req, req.params.id)) }); } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/contratos/saida-executiva', (req, res) => {
  try {
    const contratos = db.prepare('SELECT * FROM contratos WHERE empresa_id=? ORDER BY id DESC').all(req.params.id);
    const relatorios = contratos.map(carregarRelatorioContratual);
    ok(res, { painel: contratosExecutivo.painel(relatorios), relatorios });
  } catch (e) { erro(res, e); }
});

router.get('/contratos/:id/saida-executiva.pdf', async (req, res) => {
  try {
    const relatorio = carregarRelatorioContratual(await contratoPermitido(req, req.params.id));
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="relatorio-contratual.pdf"');
    contratosExecutivo.gerarPdfIndividual(relatorio, res);
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/contratos/saida-executiva.pdf', (req, res) => {
  try {
    const relatorios = db.prepare('SELECT * FROM contratos WHERE empresa_id=? ORDER BY id DESC').all(req.params.id).map(carregarRelatorioContratual);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="carteira-contratual.pdf"');
    contratosExecutivo.gerarPdfCarteira({ painel: contratosExecutivo.painel(relatorios), relatorios }, res);
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// MÓDULO 4 — CAPACITAÇÃO
// ===========================================================================
router.get('/turmas/compartilhadas', async (req, res) => {
  try {
    const permitidas = await empresasPermitidasUsuario(req.usuario);
    const turmas = db.prepare("SELECT * FROM turmas WHERE trilha='workshop_boas_praticas' ORDER BY data DESC, id DESC").all();
    const empresas = db.prepare('SELECT id,razao_social FROM empresas').all();
    const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.razao_social]));
    const participantes = db.prepare('SELECT turma_id,empresa_id FROM participantes WHERE empresa_id IS NOT NULL').all();
    const saida = turmas.map((t) => {
      const ids = [...new Set(participantes.filter((p) => p.turma_id === t.id).map((p) => p.empresa_id))];
      return { ...t, participantes: participantes.filter((p) => p.turma_id === t.id).length, empresas: ids.map((id) => nomeEmpresa.get(id) || 'Empresa não identificada') };
    }).filter((t) => permitidas === null || permitidas.has(String(t.empresa_id)) || t.empresas.some((nome) => empresas.some((e) => e.razao_social === nome && permitidas.has(String(e.id)))));
    ok(res, { turmas: saida });
  } catch (e) { erro(res, e); }
});
router.get('/empresas/:id/turmas', (req, res) => {
  const turmas = db.prepare(`SELECT * FROM turmas WHERE (trilha='workshop_pratico' AND empresa_id=?)
    OR (trilha='workshop_boas_praticas' AND (empresa_id=? OR id IN (SELECT turma_id FROM participantes WHERE empresa_id=?))) ORDER BY data DESC, id DESC`).all(req.params.id, req.params.id, req.params.id);
  const part = db.prepare(`SELECT p.*, e.razao_social AS empresa_nome FROM participantes p LEFT JOIN empresas e ON e.id=p.empresa_id WHERE p.turma_id = ? ORDER BY e.razao_social, p.nome`);
  ok(res, { turmas: turmas.map((t) => ({ ...t, participantes: part.all(t.id) })), trilhas: TRILHAS,
    limitePadrao: Number(db.prepare("SELECT valor FROM param_regras WHERE grupo='capacitacao' AND chave='limite_padrao_turma'").get()?.valor) || 30 });
});

router.post('/empresas/:id/turmas', (req, res) => {
  try {
    const b = req.body;
    const r = db.prepare(`INSERT INTO turmas (empresa_id, trilha, titulo, formato, data, carga_horaria, instrutor, limite_participantes, status, observacoes)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(req.params.id, b.trilha || '', b.titulo || '', b.formato || 'presencial',
      b.data || '', +b.carga_horaria || 4, b.instrutor || '', Math.max(1, +b.limite_participantes || Number(db.prepare("SELECT valor FROM param_regras WHERE grupo='capacitacao' AND chave='limite_padrao_turma'").get()?.valor) || 30), b.status || 'planejada', b.observacoes || '');
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.put('/turmas/:id', async (req, res) => {
  try {
    await turmaPermitida(req, req.params.id);
    const b = req.body;
    db.prepare('UPDATE turmas SET trilha=?, titulo=?, formato=?, data=?, carga_horaria=?, instrutor=?, limite_participantes=?, status=?, observacoes=? WHERE id=?')
      .run(b.trilha, b.titulo, b.formato, b.data, +b.carga_horaria || 4, b.instrutor, Math.max(1, +b.limite_participantes || 30), b.status, b.observacoes || '', req.params.id);
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.delete('/turmas/:id', async (req, res) => { try { await turmaPermitida(req, req.params.id); db.prepare('DELETE FROM turmas WHERE id=?').run(req.params.id); ok(res, {}); } catch (e) { erro(res, e); } });

router.post('/turmas/:id/participantes', async (req, res) => {
  try {
    const turma = await turmaPermitida(req, req.params.id);
    const b = req.body;
    const total = db.prepare('SELECT COUNT(*) AS total FROM participantes WHERE turma_id=?').get(req.params.id).total;
    if (total >= Number(turma.limite_participantes || 30)) throw new Error(`Esta turma atingiu o limite de ${turma.limite_participantes || 30} participantes.`);
    const empresaId = turma.trilha === 'workshop_boas_praticas' ? Number(b.empresa_id) : Number(turma.empresa_id);
    if (!empresaId) throw new Error('Selecione a empresa do participante.');
    await garantirEmpresaPermitida(req, empresaId);
    const r = db.prepare('INSERT INTO participantes (turma_id, empresa_id, nome, area, email, presenca) VALUES (?,?,?,?,?,?)')
      .run(req.params.id, empresaId, b.nome, b.area || '', b.email || '', b.presenca ? 1 : 0);
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.put('/participantes/:id', async (req, res) => {
  try {
    await participantePermitido(req, req.params.id);
    const b = req.body;
    db.prepare('UPDATE participantes SET nome=?, area=?, email=?, presenca=?, nota_avaliacao=? WHERE id=?')
      .run(b.nome, b.area || '', b.email || '', b.presenca ? 1 : 0, b.nota_avaliacao || null, req.params.id);
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.delete('/participantes/:id', async (req, res) => { try { await participantePermitido(req, req.params.id); db.prepare('DELETE FROM participantes WHERE id=?').run(req.params.id); ok(res, {}); } catch (e) { erro(res, e); } });

router.post('/turmas/:id/importar', upload.single('arquivo'), async (req, res) => {
  try {
    const turma = await turmaPermitida(req, req.params.id);
    const { linhas } = imp.lerPlanilha(req.file.buffer);
    const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const acha = (l, nomes) => { for (const k of Object.keys(l)) { if (nomes.includes(norm(k))) return l[k]; } return ''; };
    const total = db.prepare('SELECT COUNT(*) AS total FROM participantes WHERE turma_id=?').get(req.params.id).total;
    const vagas = Math.max(0, Number(turma?.limite_participantes || 30) - total);
    const ins = db.prepare('INSERT INTO participantes (turma_id, empresa_id, nome, area, email) VALUES (?,?,?,?,?)');
    const empresas = db.prepare('SELECT id,cnpj,razao_social,nome_fantasia FROM empresas').all();
    const permitidas = await empresasPermitidasUsuario(req.usuario);
    const localizarEmpresa = (linha) => {
      if (turma.trilha !== 'workshop_boas_praticas') return Number(turma.empresa_id);
      const cnpj = String(acha(linha, ['cnpj', 'cnpjempresa', 'documentoempresa']) || '').replace(/\D/g, '');
      const nome = String(acha(linha, ['empresa', 'razaosocial', 'nomeempresa']) || '').trim().toLowerCase();
      const encontrada = empresas.find((e) => (cnpj && String(e.cnpj || '').replace(/\D/g, '') === cnpj) || (nome && [e.razao_social, e.nome_fantasia].some((v) => String(v || '').trim().toLowerCase() === nome)));
      return encontrada ? Number(encontrada.id) : Number(turma.empresa_id);
    };
    let n = 0, foraDaCarteira = 0;
    db.transaction(() => { for (const l of linhas) {
      const nome = String(acha(l, ['nome', 'participante', 'colaborador']) || '').trim();
      if (!nome || n >= vagas) continue;
      const empresaId = localizarEmpresa(l);
      if (permitidas !== null && !permitidas.has(String(empresaId))) { foraDaCarteira++; continue; }
      ins.run(req.params.id, empresaId, nome, String(acha(l, ['area', 'setor', 'departamento']) || ''), String(acha(l, ['email', 'mail']) || ''));
      n++;
    } })();
    ok(res, { importados: n, foraDaCarteira, semVagas: Math.max(0, linhas.length - n - foraDaCarteira) });
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// CATÁLOGO DE SERVIÇOS, COMBOS E PROPOSTAS
// ===========================================================================
const ENTREGAS_PROJETO = {
  diagnostico: 'Diagnóstico', precificacao: 'Precificação', contratos: 'Revisão de contratos',
  treinamento_boas_praticas: 'Treinamento Boas Práticas', capacitacao_operacional: 'Capacitação operacional',
};
const competenciaMais = (competencia, deslocamento) => {
  const [ano, mes] = String(competencia || '').split('-').map(Number);
  if (!ano || !mes) return null;
  const d = new Date(ano, mes - 1 + deslocamento, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const tituloCompetencia = (competencia, ordem) => {
  const [ano, mes] = String(competencia).split('-');
  return `Acompanhamento ${ordem} · ${mes}/${ano}`;
};
const modulosDaContratacao = (contratacao) => JSON.parse(contratacao.modulos_json || '[]');

router.get('/empresas/:id/projeto', (req, res) => {
  try {
    const projeto = db.prepare(`SELECT c.*, co.nome combo_nome FROM contratacoes c
      LEFT JOIN combos co ON co.id=c.combo_id WHERE c.empresa_id=? AND c.aprovado_em IS NOT NULL
      ORDER BY c.aprovado_em DESC, c.id DESC LIMIT 1`).get(req.params.id);
    if (!projeto) return ok(res, { projeto: null, entregas: [], acompanhamentos: [], checklist: [] });
    ok(res, { projeto: { ...projeto, modulos: modulosDaContratacao(projeto), servicos: JSON.parse(projeto.servicos_json || '[]') },
      entregas: db.prepare('SELECT * FROM projeto_entregas WHERE contratacao_id=? ORDER BY id').all(projeto.id),
      acompanhamentos: db.prepare('SELECT * FROM projeto_acompanhamentos WHERE contratacao_id=? ORDER BY competencia').all(projeto.id),
      checklist: db.prepare('SELECT * FROM projeto_checklist_implantacao WHERE contratacao_id=? ORDER BY escopo,ordem,id').all(projeto.id) });
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/acesso', async (req, res) => {
  try {
    let projeto = db.prepare(`SELECT * FROM contratacoes WHERE empresa_id=? AND aprovado_em IS NOT NULL
      ORDER BY aprovado_em DESC, id DESC LIMIT 1`).get(req.params.id);
    // O Render usa SQLite como cache. Se ele acabou de reiniciar, restaura a
    // gestão da fonte compartilhada antes de decidir se um módulo será bloqueado.
    if (!projeto && supabase.configurado()) {
      try {
        await require('../services/operacaoCompartilhada').baixarGestao();
        projeto = db.prepare(`SELECT * FROM contratacoes WHERE empresa_id=? AND aprovado_em IS NOT NULL
          ORDER BY aprovado_em DESC, id DESC LIMIT 1`).get(req.params.id);
      } catch (e) { console.error('[supabase] não foi possível restaurar gestão para acesso:', e.message); }
    }
    const modulos = projeto ? modulosDaContratacao(projeto) : [];
    ok(res, { aprovado: !!projeto, contratacao_id: projeto && projeto.id, modulos,
      telas: {
        diagnostico: modulos.includes('diagnostico'), precificacao: modulos.includes('precificacao'),
        contratos: modulos.includes('contratos'), capacitacao: modulos.some((m) => ['treinamento_boas_praticas', 'capacitacao_operacional'].includes(m)),
      },
      trilhas: modulos.filter((m) => ['treinamento_boas_praticas', 'capacitacao_operacional'].includes(m)) });
  } catch (e) { erro(res, e); }
});

router.get('/gestao/projetos', async (req, res) => {
  try {
    const permitidas = await empresasPermitidasUsuario(req.usuario);
    const contratos = db.prepare(`SELECT c.*, e.razao_social, co.nome combo_nome FROM contratacoes c
      JOIN empresas e ON e.id=c.empresa_id LEFT JOIN combos co ON co.id=c.combo_id
      WHERE c.aprovado_em IS NOT NULL ORDER BY c.aprovado_em DESC, c.id DESC`).all().filter((c) => permitidas === null || permitidas.has(String(c.empresa_id)));
    const vistos = new Set();
    const projetos = contratos.filter((c) => { if (vistos.has(c.empresa_id)) return false; vistos.add(c.empresa_id); return true; }).map((c) => {
      const entregas = db.prepare('SELECT * FROM projeto_entregas WHERE contratacao_id=?').all(c.id);
      const acompanhamentos = db.prepare('SELECT * FROM projeto_acompanhamentos WHERE contratacao_id=?').all(c.id);
      const responsaveis = db.prepare('SELECT * FROM projeto_responsaveis WHERE contratacao_id=? ORDER BY id').all(c.id);
      const tarefas = db.prepare('SELECT * FROM projeto_tarefas WHERE contratacao_id=? ORDER BY data_conclusao, id').all(c.id);
      const checklist = db.prepare('SELECT * FROM projeto_checklist_implantacao WHERE contratacao_id=? ORDER BY escopo,ordem,id').all(c.id);
      const concluidas = entregas.filter((x) => x.status === 'concluida' || x.status === 'nao_aplicavel').length;
      const acompConcluidos = acompanhamentos.filter((x) => x.status === 'concluido').length;
      const progressoImplantacao = implantacaoEscopo.progresso(checklist);
      const proximaAcao = checklist.find((x) => !['VALIDADO', 'CONCLUIDO', 'NAO_APLICAVEL'].includes(x.status)) || null;
      const responsavelProjeto = responsaveis.find((x) => x.lado === 'sattva') || null;
      return { ...c, servicos: JSON.parse(c.servicos_json || '[]'), modulos: modulosDaContratacao(c), entregas, acompanhamentos, responsaveis, tarefas, checklist, concluidas,
        progresso: entregas.length ? Math.round((concluidas / entregas.length) * 100) : 0, progresso_implantacao: progressoImplantacao,
        proxima_acao_implantacao: proximaAcao ? { id: proximaAcao.id, titulo: proximaAcao.titulo, status: proximaAcao.status } : null,
        responsavel_implantacao: responsavelProjeto ? { id: responsavelProjeto.id, nome: responsavelProjeto.nome } : null,
        acompanhamentoConcluido: acompConcluidos, proximaCompetencia: (acompanhamentos.find((x) => x.status !== 'concluido') || {}).competencia || null };
    });
    const propostas = db.prepare(`SELECT c.*, e.razao_social, co.nome combo_nome FROM contratacoes c
      JOIN empresas e ON e.id=c.empresa_id LEFT JOIN combos co ON co.id=c.combo_id
      WHERE c.aprovado_em IS NULL ORDER BY c.criado_em DESC, c.id DESC`).all()
      .filter((c) => permitidas === null || permitidas.has(String(c.empresa_id)))
      .map((c) => ({ ...c, servicos: JSON.parse(c.servicos_json || '[]') }));
    const servicos = db.prepare("SELECT id,nome,modulo,chave_entrega FROM servicos WHERE ativo=1 AND chave_entrega <> 'acompanhamento' ORDER BY ordem,nome").all();
    ok(res, { projetos, propostas, servicos });
  } catch (e) { erro(res, e); }
});

router.post('/contratacoes/:id/aprovar', async (req, res) => {
  try {
    const c = await contratacaoPermitida(req, req.params.id);
    const combo = c.combo_id ? db.prepare('SELECT acompanhamento_meses FROM combos WHERE id=?').get(c.combo_id) : null;
    const meses = Math.max(0, Number(req.body.acompanhamento_meses ?? c.acompanhamento_meses ?? combo?.acompanhamento_meses ?? 0));
    const ids = JSON.parse(c.servicos_json || '[]');
    const servicos = ids.length ? db.prepare(`SELECT chave_entrega FROM servicos WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
    const modulos = [...new Set(servicos.map((s) => s.chave_entrega).filter((x) => ENTREGAS_PROJETO[x]))];
    if (!modulos.length) throw new Error('A proposta não possui módulos de entrega configurados.');
    const insEntrega = db.prepare('INSERT OR IGNORE INTO projeto_entregas (contratacao_id, chave, titulo) VALUES (?,?,?)');
    db.transaction(() => {
      db.prepare(`UPDATE contratacoes SET status='em_execucao', aprovado_em=datetime('now','localtime'),
        competencia_referencia=?, acompanhamento_meses=?, modulos_json=?, observacoes=? WHERE id=?`)
        .run(null, meses, JSON.stringify(modulos), req.body.observacoes || c.observacoes || '', c.id);
      db.prepare('DELETE FROM projeto_entregas WHERE contratacao_id=?').run(c.id);
      db.prepare('DELETE FROM projeto_acompanhamentos WHERE contratacao_id=?').run(c.id);
      modulos.forEach((chave) => insEntrega.run(c.id, chave, ENTREGAS_PROJETO[chave]));
      implantacaoEscopo.gerarChecklist(db, c.id, modulos, meses);
    })();
    auditar(req, { empresaId: c.empresa_id, acao: 'Aprovou o escopo do projeto', entidade: 'contratacao', entidadeId: c.id,
      antes: { status: c.status }, depois: { status: 'em_execucao', modulos, acompanhamento_meses: meses } });
    ok(res, { contratacao_id: c.id, modulos, acompanhamento_meses: meses });
    sincronizarGestao();
  } catch (e) { erro(res, e); }
});

router.post('/contratacoes/:id/liberar-acompanhamento', async (req, res) => {
  try {
    const c = await contratacaoPermitida(req, req.params.id);
    if (!c.aprovado_em) throw new Error('Aprove o plano antes de liberar o acompanhamento.');
    const diagnostico = db.prepare("SELECT status FROM projeto_entregas WHERE contratacao_id=? AND chave='diagnostico'").get(c.id);
    if (!diagnostico || diagnostico.status !== 'concluida') throw new Error('Conclua o Diagnóstico antes de liberar o acompanhamento.');
    const competencia = String(req.body.competencia_referencia || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new Error('Informe o mês e ano de referência.');
    const meses = Math.max(0, Number(c.acompanhamento_meses) || 0);
    if (!meses) throw new Error('Este plano não possui meses de acompanhamento configurados.');
    const ins = db.prepare('INSERT OR IGNORE INTO projeto_acompanhamentos (contratacao_id, competencia, nome) VALUES (?,?,?)');
    db.transaction(() => {
      db.prepare('DELETE FROM projeto_acompanhamentos WHERE contratacao_id=?').run(c.id);
      for (let i = 0; i < meses; i++) { const comp = competenciaMais(competencia, i); ins.run(c.id, comp, tituloCompetencia(comp, i + 1)); }
      db.prepare('UPDATE contratacoes SET competencia_referencia=? WHERE id=?').run(competencia, c.id);
    })();
    auditar(req, { empresaId: c.empresa_id, acao: 'Liberou acompanhamento do projeto', entidade: 'contratacao', entidadeId: c.id,
      depois: { competencia_referencia: competencia, acompanhamento_meses: meses } });
    ok(res, { meses, competencia_referencia: competencia });
    sincronizarGestao();
  } catch (e) { erro(res, e); }
});

router.put('/projeto/entregas/:id', async (req, res) => {
  try {
    const status = req.body.status || 'pendente';
    const entregaAnterior = db.prepare(`SELECT pe.*, c.empresa_id FROM projeto_entregas pe JOIN contratacoes c ON c.id=pe.contratacao_id WHERE pe.id=?`).get(req.params.id);
    if (!entregaAnterior) throw new Error('Entrega não encontrada.');
    await garantirEmpresaPermitida(req, entregaAnterior.empresa_id);
    db.prepare("UPDATE projeto_entregas SET status=?, observacoes=?, concluido_em=CASE WHEN ?='concluida' THEN datetime('now','localtime') ELSE NULL END WHERE id=?")
      .run(status, req.body.observacoes || '', status, req.params.id);
    const entrega = entregaAnterior;
    const incluirResponsavel = (lado, nome, telefone, email, funcao) => {
      if (String(nome || '').trim()) db.prepare('INSERT INTO projeto_responsaveis (contratacao_id,entrega_id,lado,nome,telefone,email,funcao) VALUES (?,?,?,?,?,?,?)')
        .run(entrega.contratacao_id, req.params.id, lado, nome.trim(), telefone || '', email || '', funcao || '');
    };
    incluirResponsavel('sattva', req.body.responsavel_sattva, req.body.telefone_sattva, req.body.email_sattva, req.body.funcao_sattva);
    incluirResponsavel('cliente', req.body.responsavel_cliente, req.body.telefone_cliente, req.body.email_cliente, req.body.funcao_cliente);
    if (String(req.body.tarefa_titulo || '').trim()) db.prepare(`INSERT INTO projeto_tarefas (contratacao_id,entrega_id,titulo,descricao,status,data_abertura,data_conclusao,envolve_cliente,pendencia_cliente,interacoes_cliente,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`).run(entrega.contratacao_id, req.params.id, req.body.tarefa_titulo.trim(), req.body.tarefa_descricao || '', req.body.tarefa_status || 'aberta', req.body.tarefa_abertura || null, req.body.tarefa_conclusao || null, req.body.envolve_cliente ? 1 : 0, req.body.pendencia_cliente || '', req.body.interacoes_cliente || '');
    auditar(req, { empresaId: entrega.empresa_id, acao: 'Atualizou entrega do projeto', entidade: 'entrega', entidadeId: req.params.id,
      antes: { status: entrega.status, observacoes: entrega.observacoes }, depois: { status, observacoes: req.body.observacoes || '' } });
    ok(res, {});
    sincronizarGestao();
  } catch (e) { erro(res, e); }
});

router.put('/projeto/tarefas/:id', async (req, res) => {
  try {
    const b = req.body;
    const tarefa = db.prepare(`SELECT t.*, c.empresa_id, e.chave AS entrega_chave FROM projeto_tarefas t JOIN contratacoes c ON c.id=t.contratacao_id JOIN projeto_entregas e ON e.id=t.entrega_id WHERE t.id=?`).get(req.params.id);
    if (!tarefa) throw new Error('Tarefa não encontrada.');
    await garantirEmpresaPermitida(req, tarefa.empresa_id);
    const permissoes = req.usuario?.permissoes;
    const area = areaDaTarefaModulo(tarefa.entrega_chave);
    if (permissoes && !permissoes[area]?.executar) return res.status(403).json({ ok: false, erro: 'Seu perfil não pode atualizar tarefas deste módulo.' });
    const envolveCliente = b.tipo_pendencia ? b.tipo_pendencia === 'cliente' : Boolean(b.envolve_cliente);
    db.prepare(`UPDATE projeto_tarefas SET titulo=?,descricao=?,status=?,data_abertura=?,data_conclusao=?,envolve_cliente=?,pendencia_cliente=?,interacoes_cliente=?,atualizado_em=datetime('now','localtime') WHERE id=?`)
      .run(b.titulo || '', b.descricao || '', b.status || 'aberta', b.data_abertura || null, b.data_conclusao || null, envolveCliente ? 1 : 0, b.pendencia_cliente || '', b.interacoes_cliente || '', req.params.id);
    auditar(req, { empresaId: tarefa.empresa_id, acao: 'Atualizou tarefa do projeto', entidade: 'tarefa', entidadeId: req.params.id,
      antes: { status: tarefa.status, data_conclusao: tarefa.data_conclusao }, depois: { status: b.status || 'aberta', data_conclusao: b.data_conclusao || null } });
    ok(res, {}); sincronizarGestao();
  } catch (e) { erro(res, e); }
});

const chavesDeTarefaModulo = (chave) => (chave === 'capacitacao'
  ? ['treinamento_boas_praticas', 'capacitacao_operacional']
  : [chave]);

router.get('/empresas/:id/projeto/tarefas/:chave', async (req, res) => {
  try {
    const projeto = db.prepare(`SELECT id FROM contratacoes WHERE empresa_id=? AND aprovado_em IS NOT NULL ORDER BY aprovado_em DESC, id DESC LIMIT 1`).get(req.params.id);
    if (!projeto) return ok(res, { entregas: [], tarefas: [], responsaveis: [] });
    const projetoPermitido = await contratacaoPermitida(req, projeto.id);
    const chaves = chavesDeTarefaModulo(req.params.chave);
    const marcadores = chaves.map(() => '?').join(',');
    const entregas = db.prepare(`SELECT * FROM projeto_entregas WHERE contratacao_id=? AND chave IN (${marcadores}) ORDER BY id`).all(projetoPermitido.id, ...chaves);
    if (!entregas.length) return ok(res, { entregas: [], tarefas: [], responsaveis: [] });
    const ids = entregas.map(() => '?').join(',');
    const tarefas = db.prepare(`SELECT t.*, e.titulo AS entrega_titulo, e.chave AS entrega_chave
      FROM projeto_tarefas t JOIN projeto_entregas e ON e.id=t.entrega_id
      WHERE t.entrega_id IN (${ids})
      ORDER BY CASE t.status WHEN 'concluida' THEN 2 ELSE 1 END, t.data_conclusao, t.id`).all(...entregas.map((e) => e.id));
    const responsaveis = db.prepare(`SELECT * FROM projeto_responsaveis WHERE entrega_id IN (${ids}) ORDER BY lado, id`).all(...entregas.map((e) => e.id));
    ok(res, { entregas, tarefas, responsaveis });
  } catch (e) { erro(res, e); }
});
router.post('/empresas/:id/projeto/tarefas/:chave', async (req, res) => {
  try {
    const projetoBase = db.prepare(`SELECT id FROM contratacoes WHERE empresa_id=? AND aprovado_em IS NOT NULL ORDER BY aprovado_em DESC, id DESC LIMIT 1`).get(req.params.id);
    if (!projetoBase) throw new Error('Não há um projeto aprovado para esta empresa.');
    const projeto = await contratacaoPermitida(req, projetoBase.id);
    const b = req.body;
    const chaves = chavesDeTarefaModulo(req.params.chave);
    const marcadores = chaves.map(() => '?').join(',');
    const entregas = db.prepare(`SELECT * FROM projeto_entregas WHERE contratacao_id=? AND chave IN (${marcadores}) ORDER BY id`).all(projeto.id, ...chaves);
    const entrega = entregas.length === 1 ? entregas[0] : entregas.find((e) => String(e.id) === String(b.entrega_id));
    if (!entrega) throw new Error(entregas.length > 1 ? 'Selecione a entrega de capacitação.' : 'Este módulo não está liberado no escopo aprovado.');
    if (!String(b.titulo || '').trim()) throw new Error('Informe o título da tarefa.');
    const envolveCliente = b.tipo_pendencia ? b.tipo_pendencia === 'cliente' : Boolean(b.envolve_cliente);
    const r = db.prepare(`INSERT INTO projeto_tarefas (contratacao_id,entrega_id,titulo,descricao,status,data_abertura,data_conclusao,envolve_cliente,pendencia_cliente,interacoes_cliente,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`).run(projeto.id, entrega.id, b.titulo.trim(), b.descricao || '', b.status || 'aberta', b.data_abertura || null, b.data_conclusao || null, envolveCliente ? 1 : 0, b.pendencia_cliente || '', b.interacoes_cliente || '');
    auditar(req, { empresaId: projeto.empresa_id, acao: 'Criou tarefa do módulo', entidade: 'tarefa', entidadeId: r.lastInsertRowid, depois: { modulo: req.params.chave, titulo: b.titulo.trim() } });
    ok(res, { id: r.lastInsertRowid }); sincronizarGestao();
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/projeto/responsaveis/:chave', async (req, res) => {
  try {
    const projetoBase = db.prepare(`SELECT id FROM contratacoes WHERE empresa_id=? AND aprovado_em IS NOT NULL ORDER BY aprovado_em DESC, id DESC LIMIT 1`).get(req.params.id);
    if (!projetoBase) throw new Error('Não há um projeto aprovado para esta empresa.');
    const projeto = await contratacaoPermitida(req, projetoBase.id);
    const b = req.body, chaves = chavesDeTarefaModulo(req.params.chave), marcadores = chaves.map(() => '?').join(',');
    const entregas = db.prepare(`SELECT * FROM projeto_entregas WHERE contratacao_id=? AND chave IN (${marcadores}) ORDER BY id`).all(projeto.id, ...chaves);
    const entrega = entregas.length === 1 ? entregas[0] : entregas.find((e) => String(e.id) === String(b.entrega_id));
    if (!entrega) throw new Error(entregas.length > 1 ? 'Selecione a entrega de capacitação.' : 'Este módulo não está liberado no escopo aprovado.');
    const salvar = (lado, nome, telefone, email, funcao) => {
      if (!String(nome || '').trim()) return;
      const existente = db.prepare('SELECT id FROM projeto_responsaveis WHERE contratacao_id=? AND entrega_id=? AND lado=? ORDER BY id LIMIT 1').get(projeto.id, entrega.id, lado);
      if (existente) db.prepare('UPDATE projeto_responsaveis SET nome=?, telefone=?, email=?, funcao=? WHERE id=?').run(nome.trim(), telefone || '', email || '', funcao || '', existente.id);
      else db.prepare('INSERT INTO projeto_responsaveis (contratacao_id,entrega_id,lado,nome,telefone,email,funcao) VALUES (?,?,?,?,?,?,?)').run(projeto.id, entrega.id, lado, nome.trim(), telefone || '', email || '', funcao || '');
    };
    salvar('sattva', b.responsavel_sattva, b.telefone_sattva, b.email_sattva, b.funcao_sattva);
    salvar('cliente', b.responsavel_cliente, b.telefone_cliente, b.email_cliente, b.funcao_cliente);
    auditar(req, { empresaId: projeto.empresa_id, acao: 'Atualizou responsáveis do módulo', entidade: 'entrega', entidadeId: entrega.id, depois: { modulo: req.params.chave } });
    ok(res, {}); sincronizarGestao();
  } catch (e) { erro(res, e); }
});

router.put('/projeto/acompanhamentos/:id', async (req, res) => {
  try {
    const acompanhamento = db.prepare(`SELECT a.*, c.empresa_id FROM projeto_acompanhamentos a JOIN contratacoes c ON c.id=a.contratacao_id WHERE a.id=?`).get(req.params.id);
    if (!acompanhamento) throw new Error('Acompanhamento não encontrado.');
    await garantirEmpresaPermitida(req, acompanhamento.empresa_id);
    db.prepare('UPDATE projeto_acompanhamentos SET nome=?, status=?, observacoes=? WHERE id=?')
      .run(req.body.nome || '', req.body.status || 'planejado', req.body.observacoes || '', req.params.id);
    auditar(req, { empresaId: acompanhamento.empresa_id, acao: 'Atualizou acompanhamento do projeto', entidade: 'acompanhamento', entidadeId: req.params.id,
      antes: { status: acompanhamento.status }, depois: { status: req.body.status || 'planejado', nome: req.body.nome || '' } });
    ok(res, {});
    sincronizarGestao();
  } catch (e) { erro(res, e); }
});

router.get('/servicos', (_req, res) => {
  // Acompanhamento é regra do plano, não serviço selecionável: todos os
  // combos ativos o recebem pela quantidade de meses configurada.
  const servicos = db.prepare("SELECT * FROM servicos WHERE ativo = 1 AND chave_entrega <> 'acompanhamento' ORDER BY ordem").all();
  const combos = db.prepare('SELECT * FROM combos WHERE ativo = 1 ORDER BY destaque DESC, id').all()
    .map((c) => ({ ...c, servicos: db.prepare('SELECT servico_id FROM combo_itens WHERE combo_id = ?').all(c.id).map((x) => x.servico_id) }));
  ok(res, { servicos, combos });
});

router.post('/servicos', (req, res) => {
  try {
    const b = req.body;
    const r = db.prepare(`INSERT INTO servicos (codigo, modulo, nome, descricao, entregaveis, preco, unidade, prazo_dias, recorrente, chave_entrega, ordem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(b.codigo, b.modulo, b.nome, b.descricao || '', b.entregaveis || '',
      +b.preco || 0, b.unidade || 'projeto', +b.prazo_dias || 30, b.recorrente ? 1 : 0, b.chave_entrega || 'outro', +b.ordem || 99);
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.put('/servicos/:id', (req, res) => {
  const b = req.body;
  db.prepare('UPDATE servicos SET modulo=?, nome=?, descricao=?, entregaveis=?, preco=?, unidade=?, prazo_dias=?, recorrente=?, chave_entrega=?, ativo=? WHERE id=?')
    .run(b.modulo, b.nome, b.descricao || '', b.entregaveis || '', +b.preco || 0, b.unidade || 'projeto',
      +b.prazo_dias || 30, b.recorrente ? 1 : 0, b.chave_entrega || 'outro', b.ativo === undefined ? 1 : (b.ativo ? 1 : 0), req.params.id);
  ok(res, {});
});

router.post('/combos', (req, res) => {
  try {
    const b = req.body;
    const r = db.prepare('INSERT INTO combos (nome, descricao, desconto, destaque, acompanhamento_meses) VALUES (?,?,?,?,?)')
      .run(b.nome, b.descricao || '', +b.desconto || 0, b.destaque ? 1 : 0, Math.max(0, +b.acompanhamento_meses || 0));
    const ins = db.prepare('INSERT OR IGNORE INTO combo_itens (combo_id, servico_id) VALUES (?,?)');
    (b.servicos || []).forEach((s) => ins.run(r.lastInsertRowid, s));
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.put('/combos/acompanhamento', (req, res) => {
  try {
    const meses = Math.max(1, Math.min(36, Number(req.body.acompanhamento_meses) || 3));
    const r = db.prepare('UPDATE combos SET acompanhamento_meses=? WHERE ativo=1').run(meses);
    ok(res, { atualizados: r.changes, acompanhamento_meses: meses });
  } catch (e) { erro(res, e); }
});

router.put('/combos/:id', (req, res) => {
  const b = req.body;
  db.prepare('UPDATE combos SET nome=?, descricao=?, desconto=?, destaque=?, ativo=?, acompanhamento_meses=? WHERE id=?')
    .run(b.nome, b.descricao || '', +b.desconto || 0, b.destaque ? 1 : 0, b.ativo === undefined ? 1 : (b.ativo ? 1 : 0), Math.max(0, +b.acompanhamento_meses || 0), req.params.id);
  if (b.servicos) {
    db.prepare('DELETE FROM combo_itens WHERE combo_id = ?').run(req.params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO combo_itens (combo_id, servico_id) VALUES (?,?)');
    b.servicos.forEach((s) => ins.run(req.params.id, s));
  }
  ok(res, {});
});

router.delete('/combos/:id', (req, res) => { db.prepare('DELETE FROM combos WHERE id=?').run(req.params.id); ok(res, {}); });

router.post('/orcamento', (req, res) => {
  try {
    const ids = req.body.servicos || [];
    if (!ids.length) throw new Error('Selecione ao menos um serviço.');
    const itens = db.prepare(`SELECT * FROM servicos WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const bruto = itens.reduce((s, i) => s + i.preco, 0);
    // Melhor combo aplicável: aquele cujo conjunto está inteiramente contido na seleção
    const combos = db.prepare('SELECT * FROM combos WHERE ativo = 1').all()
      .map((c) => ({ ...c, servicos: db.prepare('SELECT servico_id FROM combo_itens WHERE combo_id = ?').all(c.id).map((x) => x.servico_id) }))
      .filter((c) => c.servicos.length && c.servicos.every((s) => ids.includes(s)))
      .sort((a, b) => b.desconto - a.desconto);
    const combo = combos[0] || null;
    const descontoPerc = req.body.desconto !== undefined ? Number(req.body.desconto) : (combo ? combo.desconto : 0);
    const desconto = bruto * descontoPerc;
    const recorrentes = itens.filter((i) => i.recorrente);
    ok(res, {
      itens, combo, valorBruto: calc.r2(bruto), descontoPerc: calc.r4(descontoPerc),
      desconto: calc.r2(desconto), valorFinal: calc.r2(bruto - desconto),
      mensalRecorrente: calc.r2(recorrentes.reduce((s, i) => s + i.preco, 0)),
      prazoTotal: Math.max(0, ...itens.map((i) => i.prazo_dias)),
      entregaveis: itens.flatMap((i) => String(i.entregaveis || '').split(';').map((s) => s.trim()).filter(Boolean)),
    });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/contratacoes', (req, res) => {
  try {
    const b = req.body;
    const servicosSelecionados = [...new Set((b.servicos || []).map(Number).filter(Boolean))];
    if (!servicosSelecionados.length) throw new Error('Selecione ao menos um serviço para registrar o escopo.');
    const combosAtivos = db.prepare('SELECT id, acompanhamento_meses FROM combos WHERE ativo=1').all().map((c) => ({
      ...c, servicos: db.prepare('SELECT servico_id FROM combo_itens WHERE combo_id=?').all(c.id).map((x) => Number(x.servico_id)),
    }));
    // Não basta ser subconjunto: somente o plano cujo escopo é idêntico à seleção é adotado.
    const combo = combosAtivos.find((c) => c.servicos.length === servicosSelecionados.length && c.servicos.every((id) => servicosSelecionados.includes(id))) || null;
    const r = db.prepare(`INSERT INTO contratacoes (empresa_id, combo_id, servicos_json, valor_bruto, desconto, valor_final, status, observacoes, acompanhamento_meses)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(req.params.id, combo?.id || null, JSON.stringify(servicosSelecionados),
      +b.valor_bruto || 0, +b.desconto || 0, +b.valor_final || 0, b.status || 'proposta', b.observacoes || '',
      Number(b.acompanhamento_meses ?? combo?.acompanhamento_meses ?? 0));
    ok(res, { id: r.lastInsertRowid });
    sincronizarGestao();
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/contratacoes', (req, res) => ok(res, {
  contratacoes: db.prepare('SELECT * FROM contratacoes WHERE empresa_id = ? ORDER BY id DESC').all(req.params.id)
    .map((c) => ({ ...c, servicos: JSON.parse(c.servicos_json || '[]') })),
}));

router.put('/contratacoes/:id', async (req, res) => {
  try {
    const antes = await contratacaoPermitida(req, req.params.id);
    const ids = Array.isArray(req.body.servicos) ? req.body.servicos.map(Number).filter(Boolean) : JSON.parse(antes.servicos_json || '[]');
    const linhas = ids.length ? db.prepare(`SELECT chave_entrega FROM servicos WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
    const modulos = [...new Set(linhas.map((s) => s.chave_entrega).filter((x) => ENTREGAS_PROJETO[x]))];
    if (!modulos.length) throw new Error('Selecione ao menos um serviço com módulo de entrega.');
    db.transaction(() => {
      db.prepare('UPDATE contratacoes SET servicos_json=?, modulos_json=?, status=?, observacoes=? WHERE id=?')
        .run(JSON.stringify(ids), JSON.stringify(modulos), req.body.status || antes.status, req.body.observacoes || '', req.params.id);
      if (antes.aprovado_em) {
        const ins = db.prepare('INSERT OR IGNORE INTO projeto_entregas (contratacao_id,chave,titulo) VALUES (?,?,?)');
        modulos.forEach((chave) => ins.run(antes.id, chave, ENTREGAS_PROJETO[chave]));
        implantacaoEscopo.gerarChecklist(db, antes.id, modulos, antes.acompanhamento_meses);
      }
    })();
    auditar(req, { empresaId: antes.empresa_id, acao: antes.aprovado_em ? 'Registrou aditivo de escopo do projeto' : 'Atualizou escopo do projeto', entidade: 'contratacao', entidadeId: req.params.id, antes: { servicos: JSON.parse(antes.servicos_json || '[]'), modulos: modulosDaContratacao(antes) }, depois: { servicos: ids, modulos } });
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.put('/projeto/checklist/:id', async (req, res) => {
  try {
    const item = db.prepare(`SELECT ci.*, c.empresa_id FROM projeto_checklist_implantacao ci
      JOIN contratacoes c ON c.id=ci.contratacao_id WHERE ci.id=?`).get(req.params.id);
    if (!item) throw new Error('Item de checklist não encontrado.');
    await garantirEmpresaPermitida(req, item.empresa_id);
    const status = String(req.body.status || item.status);
    if (!implantacaoEscopo.STATUS.includes(status)) throw new Error('Status de checklist inválido.');
    const responsavelId = req.body.responsavel_id ? Number(req.body.responsavel_id) : null;
    if (responsavelId) {
      const responsavel = db.prepare('SELECT id FROM projeto_responsaveis WHERE id=? AND contratacao_id=?').get(responsavelId, item.contratacao_id);
      if (!responsavel) throw new Error('Responsável não pertence ao projeto.');
    }
    db.prepare(`UPDATE projeto_checklist_implantacao SET status=?,responsavel_id=?,origem_tipo=?,origem_id=?,observacoes=?,atualizado_em=datetime('now','localtime') WHERE id=?`)
      .run(status, responsavelId, req.body.origem_tipo || null, req.body.origem_id || null, req.body.observacoes || '', item.id);
    auditar(req, { empresaId: item.empresa_id, acao: 'Atualizou checklist de implantação', entidade: 'checklist_implantacao', entidadeId: item.id,
      antes: { status: item.status }, depois: { status, origem_tipo: req.body.origem_tipo || null, origem_id: req.body.origem_id || null } });
    ok(res, {}); sincronizarGestao();
  } catch (e) { erro(res, e); }
});

router.delete('/contratacoes/:id', async (req, res) => { try { const contratacao = await contratacaoPermitida(req, req.params.id); db.prepare('DELETE FROM contratacoes WHERE id=?').run(req.params.id); auditar(req, { empresaId: contratacao.empresa_id, acao: 'Excluiu escopo do projeto', entidade: 'contratacao', entidadeId: req.params.id }); ok(res, {}); } catch (e) { erro(res, e); } });

// ===========================================================================
// PLANO DE AÇÃO
// ===========================================================================
router.get('/empresas/:id/acoes', (req, res) => ok(res, {
  acoes: db.prepare(`SELECT * FROM acoes WHERE empresa_id = ? ORDER BY
    CASE prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, prazo`).all(req.params.id),
}));

router.post('/empresas/:id/acoes', (req, res) => {
  const b = req.body;
  const r = db.prepare('INSERT INTO acoes (empresa_id, origem, titulo, descricao, responsavel, prazo, prioridade, status) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.params.id, b.origem || 'manual', b.titulo, b.descricao || '', b.responsavel || '', b.prazo || '', b.prioridade || 'media', b.status || 'aberta');
  auditar(req, { empresaId: req.params.id, acao: 'Criou ação no plano de adequação', entidade: 'acao', entidadeId: r.lastInsertRowid, depois: { titulo: b.titulo, prazo: b.prazo || null } });
  ok(res, { id: r.lastInsertRowid });
});

router.put('/acoes/:id', async (req, res) => {
  try {
    const b = req.body, antes = await acaoPermitida(req, req.params.id);
    db.prepare('UPDATE acoes SET titulo=?, descricao=?, responsavel=?, prazo=?, prioridade=?, status=? WHERE id=?')
      .run(b.titulo, b.descricao || '', b.responsavel || '', b.prazo || '', b.prioridade, b.status, req.params.id);
    auditar(req, { empresaId: antes.empresa_id, acao: 'Atualizou ação no plano de adequação', entidade: 'acao', entidadeId: req.params.id, antes: { status: antes.status, prazo: antes.prazo }, depois: { status: b.status, prazo: b.prazo || null } });
    ok(res, {});
  } catch (e) { erro(res, e); }
});

router.delete('/acoes/:id', async (req, res) => { try { const acao = await acaoPermitida(req, req.params.id); db.prepare('DELETE FROM acoes WHERE id=?').run(req.params.id); auditar(req, { empresaId: acao.empresa_id, acao: 'Excluiu ação do plano de adequação', entidade: 'acao', entidadeId: req.params.id, antes: { titulo: acao.titulo } }); ok(res, {}); } catch (e) { erro(res, e); } });

// ===========================================================================
// INTEGRAÇÃO QUESTOR (nWeb)
// ===========================================================================
router.get('/questor/config', (_req, res) => ok(res, { config: questor.config() }));

router.post('/questor/config', (req, res) => {
  try { ok(res, { config: questor.salvarConfig(req.body) }); } catch (e) { erro(res, e); }
});

router.post('/questor/testar', async (_req, res) => {
  try { ok(res, await questor.testar()); } catch (e) { erro(res, e); }
});

router.post('/questor/raw', async (req, res) => {
  try {
    const r = await questor.chamar({ path: req.body.path, metodo: req.body.metodo || 'GET', params: req.body.params, body: req.body.body });
    ok(res, { resposta: r, lista: questor.extrairLista(r).slice(0, 20) });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/questor/participantes', async (req, res) => {
  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
    const r = await questor.importarParticipantes(req.params.id, req.body.tipo === 'cliente' ? 'cliente' : 'fornecedor',
      { codigo_questor: empresa.codigo_questor || '', cnpj: empresa.cnpj });
    vincularRegimes(req.params.id);
    ok(res, r);
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/questor/movimentacao', async (req, res) => {
  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
    const r = await questor.importarMovimentacao(req.params.id, req.body.tipo === 'cliente' ? 'cliente' : 'fornecedor',
      { codigo_questor: empresa.codigo_questor || '', cnpj: empresa.cnpj, inicio: req.body.inicio || '', fim: req.body.fim || '' });
    ok(res, { ...r, ...vincularRegimes(req.params.id) });
  } catch (e) { erro(res, e); }
});

router.get('/questor/log', (_req, res) => ok(res, {
  log: db.prepare('SELECT * FROM questor_log ORDER BY id DESC LIMIT 100').all(),
}));

// ===========================================================================
// RELATÓRIOS
// ===========================================================================
router.get('/empresas/:id/relatorio/:tipo', async (req, res) => {
  try {
    await atualizarConfiguracaoDeCalculo();
    const { buffer, nome } = relatorio.gerar(req.params.id, req.params.tipo, req.query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(buffer);
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// PAINEL
// ===========================================================================
router.get('/empresas/:id/painel', async (req, res) => {
  try {
    const id = req.params.id;
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    if (!empresa) throw new Error('Empresa não encontrada');
    // A fotografia CBS pode chegar antes do espelho de movimentos após um
    // reinício efêmero do Render. Nesse caso, refazemos a sincronização já
    // existente antes de apresentar uma carteira artificialmente zerada.
    const temFotografiaCbs = db.prepare('SELECT COUNT(*) c FROM perfil_cbs_competencias WHERE empresa_id=?').get(id).c > 0;
    const temMovimentos = db.prepare('SELECT COUNT(*) c FROM movimentos WHERE empresa_id=?').get(id).c > 0;
    let sincronizacaoPendente = false;
    if (temFotografiaCbs && !temMovimentos) {
      try { await require('../services/operacaoCompartilhada').baixar(); }
      catch (_) { sincronizacaoPendente = true; }
    }
    const conta = (sql, ...p) => db.prepare(sql).get(id, ...p);
    const movimentosAposSincronizacao = conta('SELECT COUNT(*) c FROM movimentos WHERE empresa_id=?').c;
    sincronizacaoPendente ||= temFotografiaCbs && !movimentosAposSincronizacao;
    ok(res, {
      empresa,
      dados_operacionais_pendentes_sincronizacao: sincronizacaoPendente,
      contadores: {
        fornecedores: conta(`SELECT COUNT(*) c FROM parceiros WHERE empresa_id=? AND tipo='fornecedor'`).c,
        clientes: conta(`SELECT COUNT(*) c FROM parceiros WHERE empresa_id=? AND tipo='cliente'`).c,
        movEntradas: conta(`SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM movimentos WHERE empresa_id=? AND tipo='fornecedor'`),
        movSaidas: conta(`SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM movimentos WHERE empresa_id=? AND tipo='cliente'`),
        perfil: conta('SELECT COUNT(*) c FROM perfil_tributario WHERE empresa_id=?').c,
        itensPreco: conta('SELECT COUNT(*) c FROM itens_precificacao WHERE empresa_id=?').c,
        contratos: conta('SELECT COUNT(*) c FROM contratos WHERE empresa_id=?').c,
        contratosRisco: conta(`SELECT COUNT(*) c FROM contratos WHERE empresa_id=? AND risco='alto'`).c,
        turmas: conta('SELECT COUNT(*) c FROM turmas WHERE empresa_id=?').c,
        acoesAbertas: conta(`SELECT COUNT(*) c FROM acoes WHERE empresa_id=? AND status='aberta'`).c,
        semRegime: conta(`SELECT COUNT(*) c FROM movimentos WHERE empresa_id=? AND (regime IS NULL OR regime='')`).c,
      },
      contratacoes: db.prepare('SELECT * FROM contratacoes WHERE empresa_id = ? ORDER BY id DESC LIMIT 5').all(id),
    });
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// BASE DE CONHECIMENTO (RAG) E IA
// ===========================================================================
router.get('/conhecimento', (_req, res) => ok(res, {
  documentos: rag.listar(), estatisticas: rag.estatisticas(), ia: { ...ia.config(), chave: undefined },
}));

router.post('/conhecimento', (req, res) => {
  try {
    const b = req.body;
    if (!b.titulo || !b.conteudo) throw new Error('Informe título e conteúdo.');
    ok(res, rag.indexar({ titulo: b.titulo, fonte: b.fonte, categoria: b.categoria, conteudo: b.conteudo }));
  } catch (e) { erro(res, e); }
});

router.post('/conhecimento/upload', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Envie o arquivo no campo "arquivo".');
    const { tipo } = ia.classificar(req.file.originalname, req.file.mimetype);
    const { texto } = await ia.extrairTexto(req.file);
    if (!String(texto).trim()) throw new Error('Não foi possível extrair texto do arquivo.');
    const r = rag.indexar({
      titulo: req.body.titulo || req.file.originalname,
      fonte: req.body.fonte || req.file.originalname,
      categoria: req.body.categoria || 'geral',
      conteudo: texto, arquivo: req.file.originalname,
    });
    ok(res, { ...r, tipo, caracteres: texto.length });
  } catch (e) { erro(res, e); }
});

router.delete('/conhecimento/:id', (req, res) => {
  try { rag.remover(req.params.id); ok(res, {}); } catch (e) { erro(res, e); }
});

router.get('/conhecimento/buscar', (req, res) => {
  try { ok(res, { trechos: rag.buscar(req.query.q || '', Number(req.query.limite) || 8) }); }
  catch (e) { erro(res, e); }
});

router.post('/conhecimento/perguntar', async (req, res) => {
  try { ok(res, await ia.perguntar(req.body.pergunta || '')); } catch (e) { erro(res, e); }
});

router.get('/ia/config', (_req, res) => {
  const c = ia.config();
  ok(res, { config: { modelo: c.modelo, ativo: c.ativo, origemChave: c.origemChave } });
});

router.post('/ia/config', (req, res) => {
  try { const c = ia.salvarConfig(req.body); ok(res, { config: { modelo: c.modelo, ativo: c.ativo, origemChave: c.origemChave } }); }
  catch (e) { erro(res, e); }
});

router.post('/ia/testar', async (_req, res) => {
  try {
    const r = await ia.chamar([{ role: 'user', content: 'Responda apenas: conexao ok' }], { maxTokens: 20 });
    ok(res, { resposta: r.texto.trim(), modelo: ia.config().modelo });
  } catch (e) { erro(res, e); }
});

// ---- Análise de contrato por IA ----
router.post('/empresas/:id/contratos/analisar', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file && !req.body.texto) throw new Error('Envie o contrato como arquivo (PDF, imagem ou texto) ou cole o texto.');
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
    const contratoId = req.body.contrato_id ? Number(req.body.contrato_id) : null;
    const contrato = contratoId ? db.prepare('SELECT * FROM contratos WHERE id = ?').get(contratoId) : null;

    let texto = req.body.texto || '';
    let tipoArquivo = 'texto';
    let nomeArquivo = req.body.nome || 'texto colado';
    if (req.file) {
      const ext = await ia.extrairTexto(req.file);
      texto = ext.texto; tipoArquivo = ext.tipo; nomeArquivo = req.file.originalname;
    }

    const r = await ia.analisarContrato(texto, { empresa, contrato });
    const reg = db.prepare(`INSERT INTO contrato_analises (contrato_id, empresa_id, arquivo, tipo_arquivo,
      caracteres, texto_extraido, resultado, fontes, modelo, tokens_entrada, tokens_saida, status, mensagem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(contratoId, req.params.id, nomeArquivo, tipoArquivo,
      r.caracteres, texto, JSON.stringify(r.analise), JSON.stringify(r.fontes), ia.config().modelo,
      r.uso.input_tokens || 0, r.uso.output_tokens || 0, 'concluida', r.truncado ? 'Documento truncado por tamanho.' : '');

    if (contratoId && r.analise.risco_geral) {
      db.prepare('UPDATE contratos SET risco = ?, status = ? WHERE id = ?')
        .run(r.analise.risco_geral, 'em_revisao', contratoId);
    }
    ok(res, { id: reg.lastInsertRowid, ...r });
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/analises', (req, res) => ok(res, {
  analises: db.prepare(`SELECT id, contrato_id, arquivo, tipo_arquivo, caracteres, modelo,
      tokens_entrada, tokens_saida, status, mensagem, criado_em
    FROM contrato_analises WHERE empresa_id = ? ORDER BY id DESC`).all(req.params.id),
}));

router.get('/analises/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM contrato_analises WHERE id = ?').get(req.params.id);
  if (!a) return erro(res, new Error('Análise não encontrada'), 404);
  ok(res, { analise: { ...a, resultado: JSON.parse(a.resultado || '{}'), fontes: JSON.parse(a.fontes || '[]') } });
});

router.delete('/analises/:id', (req, res) => {
  db.prepare('DELETE FROM contrato_analises WHERE id = ?').run(req.params.id); ok(res, {});
});

/** Aplica os achados da IA ao checklist do contrato e abre ações no plano */
router.post('/analises/:id/aplicar', (req, res) => {
  try {
    const a = db.prepare('SELECT * FROM contrato_analises WHERE id = ?').get(req.params.id);
    if (!a) throw new Error('Análise não encontrada');
    const contratoId = Number(req.body.contrato_id || a.contrato_id);
    if (!contratoId) throw new Error('Informe a qual contrato os achados devem ser aplicados.');
    const resultado = JSON.parse(a.resultado || '{}');
    const up = db.prepare('UPDATE contrato_checklist SET situacao=?, observacao=? WHERE contrato_id=? AND clausula_id=?');
    const ins = db.prepare('INSERT INTO contrato_checklist (contrato_id, clausula_id, situacao, observacao) VALUES (?,?,?,?)');
    let aplicados = 0;
    db.transaction(() => {
      for (const f of resultado.achados || []) {
        if (!f.clausula_id) continue;
        const obs = [f.analise, f.trecho ? `Trecho: "${f.trecho}"` : ''].filter(Boolean).join(' | ').slice(0, 900);
        const r = up.run(f.situacao || 'ausente', obs, contratoId, f.clausula_id);
        if (!r.changes) ins.run(contratoId, f.clausula_id, f.situacao || 'ausente', obs);
        aplicados++;
      }
    })();
    let acoes = 0;
    if (req.body.criar_acoes) {
      const insA = db.prepare(`INSERT INTO acoes (empresa_id, origem, titulo, descricao, prioridade, status)
        VALUES (?,?,?,?,?, 'aberta')`);
      db.transaction(() => {
        for (const ac of resultado.acoes || []) {
          insA.run(a.empresa_id, 'análise de contrato (IA)', ac.titulo, ac.descricao || '', ac.prioridade || 'media');
          acoes++;
        }
      })();
    }
    const itens = db.prepare('SELECT * FROM contrato_checklist WHERE contrato_id = ?').all(contratoId);
    const criticas = itens.filter((i) => i.situacao === 'ausente' &&
      (CLAUSULAS.find((c) => c.id === i.clausula_id) || {}).risco === 'alto').length;
    const risco = resultado.risco_geral || (criticas >= 3 ? 'alto' : criticas >= 1 ? 'medio' : 'baixo');
    db.prepare('UPDATE contratos SET risco = ?, status = ?, parecer = ? WHERE id = ?')
      .run(risco, 'em_revisao', resultado.resumo || '', contratoId);
    db.prepare('UPDATE contrato_analises SET contrato_id = ? WHERE id = ?').run(contratoId, req.params.id);
    ok(res, { aplicados, acoes, risco });
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// BASES DE CLASSIFICAÇÃO TRIBUTÁRIA (NCM e NBS/LC116)
// ===========================================================================
router.get('/bases', (_req, res) => ok(res, { estatisticas: bases.estatisticas() }));

router.post('/bases/importar/:tipo', upload.single('arquivo'), (req, res) => {
  try {
    if (!req.file) throw new Error('Envie a planilha no campo "arquivo".');
    const opcoes = { arquivo: req.file.originalname, aba: req.body.aba || undefined };
    const r = req.params.tipo === 'catalogo-fiscal'
      ? bases.importarCatalogoFiscal(req.file.buffer, opcoes)
      : req.params.tipo === 'ncm'
        ? bases.importarNcm(req.file.buffer, opcoes)
        : bases.importarServicos(req.file.buffer, opcoes);

    // A base é global — afeta todos os clientes já cadastrados, não só o
    // ativo na tela. Sem isso, o usuário vê "X registros carregados" mas a
    // movimentação já importada continua com a classificação antiga até
    // alguém lembrar de clicar em "Classificar movimentação" empresa por
    // empresa. Reclassifica todas de uma vez e devolve o resumo.
    const empresas = db.prepare(`SELECT DISTINCT empresa_id FROM movimentos`).all();
    const reclassificacao = { empresas: empresas.length, totalMovimentos: 0,
      requerDecisao: 0, naoEncontrado: 0, porEmpresa: [] };
    for (const { empresa_id } of empresas) {
      const res2 = bases.classificarMovimentos(empresa_id);
      reclassificacao.totalMovimentos += res2.total;
      reclassificacao.requerDecisao += res2.requerDecisao;
      reclassificacao.naoEncontrado += res2.naoEncontrado;
      reclassificacao.porEmpresa.push({ empresa_id, ...res2 });
    }

    ok(res, { ...r, reclassificacao,
      aviso: reclassificacao.empresas
        ? `${reclassificacao.totalMovimentos} lançamentos reclassificados em ${reclassificacao.empresas} empresa(s). Se algum cenário já foi calculado, execute o motor novamente para os números refletirem a nova base.`
        : null });
  } catch (e) { erro(res, e); }
});

router.get('/bases/consultar', (req, res) => {
  try {
    if (req.query.ncm) return ok(res, { resultado: bases.consultarNcm(req.query.ncm) });
    if (req.query.nbs || req.query.lc116) return ok(res, { resultado: bases.consultarServico(req.query.lc116, req.query.nbs) });
    throw new Error('Informe ncm, nbs ou lc116.');
  } catch (e) { erro(res, e); }
});

router.get('/bases/buscar', (req, res) => {
  try { ok(res, bases.buscar(req.query.q || '', Number(req.query.limite) || 60)); }
  catch (e) { erro(res, e); }
});

// Catálogo paginado das bases oficiais, enriquecido com as regras específicas
// de venda para governo/autarquias. A regra fica visível; o motor continua
// aplicando-a somente quando o destinatário estiver confirmado como ente público.
router.get('/bases/catalogo', (req, res) => {
  try {
    const tipo = req.query.tipo === 'servicos' ? 'servicos' : 'ncm';
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const tamanho = Math.min(100, Math.max(10, Number(req.query.tamanho) || 50));
    const busca = String(req.query.busca || '').trim();
    const digitos = busca.replace(/\D/g, '');
    const termo = `%${busca}%`;
    const condicao = tipo === 'ncm'
      ? (busca ? 'WHERE ncm LIKE ? OR descricao LIKE ? OR classificacao LIKE ? OR cclasstrib LIKE ?' : '')
      : (busca ? 'WHERE nbs LIKE ? OR lc116 LIKE ? OR descricao_item LIKE ? OR descricao_nbs LIKE ? OR cclasstrib LIKE ?' : '');
    const parametros = tipo === 'ncm'
      ? (busca ? [`${digitos}%`, termo, termo, termo] : [])
      : (busca ? [`${digitos}%`, `${digitos}%`, termo, termo, termo] : []);
    const tabela = tipo === 'ncm' ? 'base_ncm' : 'base_servicos';
    const ordem = tipo === 'ncm' ? 'ncm, cclasstrib' : 'nbs, lc116, cclasstrib';
    const total = db.prepare(`SELECT COUNT(*) c FROM ${tabela} ${condicao}`).get(...parametros).c;
    const itens = db.prepare(`SELECT * FROM ${tabela} ${condicao} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
      .all(...parametros, tamanho, (pagina - 1) * tamanho);
    const regras = db.prepare('SELECT * FROM regras_governo').all();
    const codigo = (v) => String(v || '').replace(/\D/g, '');
    const beneficios = (item) => regras.filter((r) => {
      const chaves = tipo === 'ncm' ? [item.ncm] : [item.nbs, item.lc116];
      const candidatos = [r.chave, r.ncm, r.nbs, r.lc116].map(codigo).filter(Boolean);
      return chaves.map(codigo).filter(Boolean).some((chave) => candidatos.includes(chave));
    }).map((r) => ({ tratamento: r.tratamento || '', reducao: r.reducao, aliquota_zero: Boolean(r.aliquota_zero),
      cst: r.cst || '', cclasstrib: r.cclasstrib || '', ente_elegivel: r.ente_elegivel || '',
      condicoes: r.condicoes || '', fundamento: r.fundamento || '', fonte: r.fonte || '' }));
    ok(res, { tipo, pagina, tamanho, total, itens: itens.map((item) => ({ ...item, beneficios: beneficios(item) })) });
  } catch (e) { erro(res, e); }
});

// Exportação integral do catálogo. Mantém NCM, NBS e as regras de governo em
// abas separadas para que a equipe possa auditar a origem de cada tratamento.
router.get('/bases/catalogo/exportar', (req, res) => {
  try {
    const codigo = (v) => String(v || '').replace(/\D/g, '');
    const regrasGoverno = db.prepare('SELECT * FROM regras_governo ORDER BY tipo, chave, cclasstrib').all();
    const beneficios = (item, tipo) => regrasGoverno.filter((r) => {
      const chaves = tipo === 'ncm' ? [item.ncm] : [item.nbs, item.lc116];
      const candidatos = [r.chave, r.ncm, r.nbs, r.lc116].map(codigo).filter(Boolean);
      return chaves.map(codigo).filter(Boolean).some((chave) => candidatos.includes(chave));
    });
    const comBeneficios = (itens, tipo, montar) => itens.flatMap((item) => {
      const encontrados = beneficios(item, tipo);
      return (encontrados.length ? encontrados : [null]).map((beneficio) => montar(item, beneficio));
    });
    const camposBeneficio = (b) => ({
      'Tem benefício governo/autarquia?': b ? 'SIM' : 'NÃO',
      'Origem da linha do benefício': b?.origem_linha || '',
      'Tratamento governo/autarquia': b?.tratamento || '',
      'Redução governo/autarquia': b?.reducao ?? '',
      'Alíquota zero governo/autarquia': b ? (b.aliquota_zero ? 'SIM' : 'NÃO') : '',
      'CST governo/autarquia': b?.cst || '',
      'cClassTrib governo/autarquia': b?.cclasstrib || '',
      'Ente elegível': b?.ente_elegivel || '', Condições: b?.condicoes || '',
      'Fundamento governo/autarquia': b?.fundamento || '',
      'Fonte governo/autarquia': b?.fonte || '',
    });
    const ncm = comBeneficios(db.prepare('SELECT * FROM base_ncm ORDER BY ncm, cclasstrib').all(), 'ncm', (item, b) => ({
        NCM: item.ncm, 'Descrição': item.descricao, 'CST IBS/CBS': item.cst,
        cClassTrib: item.cclasstrib, Classificação: item.classificacao, Anexo: item.anexo,
        Fundamento: item.fundamento, 'Redução IBS geral': item.reducao_ibs,
        'Redução CBS geral': item.reducao_cbs, 'Tratamento geral': item.reducao,
        Regra: item.regra, Fonte: item.fonte, ...camposBeneficio(b),
    }));
    const servicos = comBeneficios(db.prepare('SELECT * FROM base_servicos ORDER BY nbs, lc116, cclasstrib').all(), 'servicos', (item, b) => ({
        NBS: item.nbs, 'LC 116': item.lc116, 'Descrição NBS': item.descricao_nbs,
        'Descrição do serviço': item.descricao_item, Onerosa: item.onerosa, Exterior: item.exterior,
        INDOP: item.indop, 'Local de incidência': item.local_incidencia,
        cClassTrib: item.cclasstrib, 'Nome cClassTrib': item.nome_cclasstrib,
        'Tratamento geral': item.reducao, ...camposBeneficio(b),
    }));
    const wb = XLSX.utils.book_new();
    const adicionarAba = (nome, linhas) => {
      const ws = XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ Informação: 'Nenhum cadastro disponível.' }]);
      const chaves = Object.keys(linhas[0] || { Informação: '' });
      ws['!cols'] = chaves.map((chave) => ({ wch: Math.min(52, Math.max(14, chave.length + 2)) }));
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: Math.max(0, chaves.length - 1), r: Math.max(0, linhas.length) } }) };
      XLSX.utils.book_append_sheet(wb, ws, nome);
    };
    adicionarAba('Produtos NCM', ncm);
    adicionarAba('Serviços NBS', servicos);
    adicionarAba('Benefícios governo', regrasGoverno.map((r) => ({
      Tipo: r.tipo, Chave: r.chave, NCM: r.ncm, NBS: r.nbs, 'LC 116': r.lc116, Descrição: r.descricao,
      Tratamento: r.tratamento, Redução: r.reducao, 'Alíquota zero': r.aliquota_zero ? 'SIM' : 'NÃO',
      CST: r.cst, cClassTrib: r.cclasstrib, INDOP: r.indop, 'Ente elegível': r.ente_elegivel,
      Condições: r.condicoes, Fundamento: r.fundamento, Fonte: r.fonte, 'Origem da linha': r.origem_linha,
    })));
    const arquivo = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="catalogo-fiscal-ncm-nbs.xlsx"');
    res.end(arquivo);
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/bases/classificar', (req, res) => {
  try { ok(res, { resultado: bases.classificarMovimentos(req.params.id) }); }
  catch (e) { erro(res, e); }
});

router.get('/empresas/:id/bases/pendencias', (req, res) => {
  try { ok(res, { pendencias: bases.pendencias(req.params.id) }); }
  catch (e) { erro(res, e); }
});

router.post('/empresas/:id/bases/decidir', (req, res) => {
  try { ok(res, bases.decidir(req.params.id, req.body.ncm, req.body.cclasstrib)); }
  catch (e) { erro(res, e); }
});

// ===========================================================================
// MOTOR DE ANÁLISE E PROJEÇÃO TRIBUTÁRIA
// ===========================================================================

// ---- Importação de XML (fonte principal) ----
router.post('/empresas/:id/importar/xml', upload.array('arquivos', 500), (req, res) => {
  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
    if (!empresa) throw new Error('Empresa não encontrada.');
    const arquivos = req.files || [];
    if (!arquivos.length) throw new Error('Envie um ou mais arquivos XML no campo "arquivos".');

    const lote = db.prepare(`INSERT INTO lotes (empresa_id, tipo, arquivo, registros, origem)
      VALUES (?,?,?,0,'xml')`).run(req.params.id, 'xml', `${arquivos.length} XML(s)`);

    const insMov = db.prepare(`INSERT INTO movimentos (empresa_id, lote_id, tipo, sentido, nome, inscr_federal,
      descricao, ncm, nbs, cfop, cst, csosn, competencia, documento, chave, item_numero, codigo_produto,
      quantidade, unidade, data_emissao, emitente_cnpj, destinatario_cnpj,
      valor, base_calculo, icms, icms_st, ipi, pis, cofins, pis_cofins_documentado, iss, frete, seguro, outras, desconto,
      cst_declarado, cclasstrib_declarado, ibs_declarado, cbs_declarado, origem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'xml')`);
    const insPar = db.prepare(`INSERT INTO parceiros (empresa_id, tipo, cnpj, descricao, regime, uf, origem)
      VALUES (?,?,?,?,?,?, 'xml')
      ON CONFLICT(empresa_id, tipo, cnpj) DO UPDATE SET descricao = excluded.descricao`);

    const relatorio = { arquivos: arquivos.length, documentos: 0, itens: 0, entradas: 0, saidas: 0,
      requerValidacao: 0, erros: [], regimesSugeridos: 0 };

    db.transaction(() => {
      for (const f of arquivos) {
        try {
          const r = xml.lerXml(f.buffer.toString('utf8'), empresa.cnpj);
          relatorio.documentos++;
          if (r.sentido === 'requer_validacao') {
            relatorio.requerValidacao++;
            relatorio.erros.push(`${f.originalname}: CNPJ da empresa não aparece como emitente nem destinatário.`);
            continue;
          }
          const tipoParceiro = r.sentido === 'entrada' ? 'fornecedor' : 'cliente';
          if (r.parceiro.cnpj) {
            const reg = (r.regimeSugerido && r.regimeSugerido.regime) || '';
            insPar.run(req.params.id, tipoParceiro, r.parceiro.cnpj, r.parceiro.nome || r.parceiro.cnpj,
              reg, r.parceiro.uf || '');
            if (reg) relatorio.regimesSugeridos++;
          }
          for (const i of r.itens) {
            insMov.run(req.params.id, lote.lastInsertRowid, tipoParceiro, i.sentido, i.nome, i.inscr_federal,
              i.descricao, i.ncm || '', i.nbs || '', i.cfop || '', i.cst || '', i.csosn || '', i.competencia,
              i.documento, i.chave || '', i.item_numero, i.codigo_produto || '', i.quantidade || 0,
              i.unidade || '', i.data_emissao || '', i.emitente_cnpj, i.destinatario_cnpj,
              i.valor, i.base_calculo || i.valor, i.icms || 0, i.icms_st || 0, i.ipi || 0,
              i.pis || 0, i.cofins || 0, i.pis_cofins_documentado ? 1 : 0, i.iss || 0, i.frete || 0, i.seguro || 0, i.outras || 0, i.desconto || 0,
              (i.declarado && i.declarado.cst) || '', (i.declarado && i.declarado.cclasstrib) || '',
              (i.declarado && i.declarado.ibs) || 0, (i.declarado && i.declarado.cbs) || 0);
            relatorio.itens++;
            if (i.sentido === 'entrada') relatorio.entradas++; else relatorio.saidas++;
          }
        } catch (e) { relatorio.erros.push(`${f.originalname}: ${e.message}`); }
      }
    })();

    db.prepare('UPDATE lotes SET registros = ? WHERE id = ?').run(relatorio.itens, lote.lastInsertRowid);
    const vinculo = vincularRegimes(req.params.id);
    let classificacao = null;
    try {
      const tem = db.prepare('SELECT (SELECT COUNT(*) FROM base_ncm) + (SELECT COUNT(*) FROM base_servicos) c').get().c;
      if (tem) classificacao = bases.classificarMovimentos(req.params.id);
    } catch (_) { /* segue sem classificar */ }
    const enriquecimento = agendarEnriquecimentoAutomatico(req.params.id);
    ok(res, { ...relatorio, classificacao, semRegime: vinculo.semRegime,
      enriquecimento: { status: enriquecimento.status, mensagem: 'CNPJs pendentes foram enviados para enriquecimento automático.' } });
  } catch (e) { erro(res, e); }
});

// ---- Execução do motor ----
router.post('/empresas/:id/motor/executar', (req, res) => {
  try {
    const r = motorExec.executar(req.params.id, { ano: req.body.ano, anexoSimples: req.body.anexo });
    ok(res, { resumo: r.resumo, ano: r.ano });
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/motor', (req, res) => {
  try {
    const ex = motorExec.ultimaExecucao(req.params.id);
    ok(res, { execucao: ex, anos: motor.anosDisponiveis() });
  } catch (e) { erro(res, e); }
});

/** Itens 34 e 35 — consolidado por fornecedor e por cliente */
function consolidado(lado) {
  return async (req, res) => {
    try {
      // A cadeia é uma projeção ao vivo; deve carregar os parâmetros de
      // crédito antes de calcular, inclusive se a requisição cair em outra
      // instância do Render.
      if (supabase.configurado()) {
        await require('../services/operacaoCompartilhada').baixarConfiguracao(['param_regimes','param_aliquotas','param_simples']);
        regras.invalidar();
      }
      const r = motorExec.executar(req.params.id, { ano: req.query.ano, gravar: false });
      ok(res, {
        ano: r.ano,
        linhas: lado === 'fornecedores' ? motorExec.porFornecedor(r) : motorExec.porCliente(r),
        resumo: r.resumo,
        cenariosSimples: r.cenariosSimples,
      });
    } catch (e) { erro(res, e); }
  };
}
router.get('/empresas/:id/motor/fornecedores', consolidado('fornecedores'));
router.get('/empresas/:id/motor/clientes', consolidado('clientes'));

/** Item 36 — Classificações */
router.get('/empresas/:id/motor/classificacoes', (req, res) => {
  try {
    ok(res, { itens: motorExec.resultados(req.params.id, {
      sentido: req.query.sentido, status: req.query.status, limite: req.query.limite }) });
  } catch (e) { erro(res, e); }
});

/** Item 37 — Conformidade */
router.get('/empresas/:id/motor/conformidade', (req, res) => {
  try {
    const ex = motorExec.ultimaExecucao(req.params.id);
    if (!ex) throw new Error('Execute o motor antes de consultar a conformidade.');
    ok(res, { conformidade: ex.resumo.conformidade || [], ano: ex.ano, executadoEm: ex.criado_em });
  } catch (e) { erro(res, e); }
});

/** Item 38 — Simulações tributárias */
router.get('/empresas/:id/motor/simulacoes', (req, res) => {
  try {
    const r = motorExec.executar(req.params.id, { ano: req.query.ano, gravar: false });
    ok(res, { ano: r.ano, resumo: r.resumo, apuracao: r.apuracao });
  } catch (e) { erro(res, e); }
});

/** Item 24 — comparador de perfis de cliente sobre a mesma operação */
router.post('/empresas/:id/motor/comparar', (req, res) => {
  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
    const item = req.body.movimento_id
      ? motorExec.normalizar(db.prepare('SELECT * FROM movimentos WHERE id = ?').get(req.body.movimento_id))
      : req.body.item;
    if (!item) throw new Error('Informe movimento_id ou o item a comparar.');
    ok(res, { comparativo: motor.compararPerfis(item, { empresa, ano: req.body.ano || 2033 }), item });
  } catch (e) { erro(res, e); }
});

/** Item 28 — parâmetros de alíquotas, editáveis */
router.get('/motor/parametros', (_req, res) => ok(res, {
  aliquotas: db.prepare('SELECT * FROM param_aliquotas ORDER BY ano').all(),
  simples: db.prepare('SELECT * FROM param_simples ORDER BY anexo, faixa').all(),
}));

router.put('/motor/parametros/:ano', (req, res) => {
  try {
    const b = req.body;
    db.prepare(`UPDATE param_aliquotas SET ibs = ?, cbs = ?, calcular_ibs = ?, fator_icms_iss = ?, fator_pis_cofins = ?,
      fator_ipi = ?, compensavel = ?, simulacao = ?, fonte = ?, nota = ?,
      atualizado_em = datetime('now','localtime') WHERE ano = ?`)
      .run(Number(b.ibs) || 0, Number(b.cbs) || 0, b.calcular_ibs ? 1 : 0, Number(b.fator_icms_iss) || 0,
        Number(b.fator_pis_cofins) || 0, Number(b.fator_ipi) || 0,
        b.compensavel ? 1 : 0, b.simulacao ? 1 : 0, b.fonte || '', b.nota || '', req.params.ano);
    ok(res, {});
  } catch (e) { erro(res, e); }
});

// ---- Importação de SPED (EFD ICMS/IPI e EFD Contribuições) ----
router.post('/empresas/:id/importar/sped', upload.array('arquivos', 60), (req, res) => {
  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
    if (!empresa) throw new Error('Empresa não encontrada.');
    const arquivos = req.files || [];
    if (!arquivos.length) throw new Error('Envie um ou mais arquivos de SPED no campo "arquivos".');

    // A identificação e a validação acontecem antes de criar qualquer lote:
    // arquivo ilegível, de outra empresa ou fora do leiaute não deixa lote órfão.
    const preparados = arquivos.map((arquivo) => ({ arquivo, resultado: sped.inspecionarCabecalho(arquivo.buffer, empresa.cnpj) }));
    const efd = preparados.filter(({ resultado }) => resultado.tipoArquivo === 'efd_contribuicoes');
    let lote;
    if (efd.length) {
      if (preparados.length !== 1) throw new Error('Envie EFD-Contribuições em arquivo individual.');
      const { arquivo, resultado } = efd[0];
      const hashSha256 = crypto.createHash('sha256').update(arquivo.buffer).digest('hex');
      const existente = db.prepare(`SELECT id FROM lotes WHERE empresa_id=? AND tipo_arquivo='EFD_CONTRIBUICOES' AND hash_sha256=?`).get(req.params.id, hashSha256);
      if (existente) return ok(res, { status: 'DUPLICADO', loteId: existente.id, mensagem: 'Este arquivo EFD-Contribuições já foi importado para a empresa.' });
      try {
        lote = db.prepare(`INSERT INTO lotes (empresa_id,tipo,arquivo,registros,origem,tipo_arquivo,hash_sha256,competencia_inicio,competencia_fim,cnpj_arquivo,status_importacao)
          VALUES (?,?,?,0,'sped','EFD_CONTRIBUICOES',?,?,?,?, 'PROCESSANDO')`).run(req.params.id, 'sped', arquivo.originalname.slice(0, 200), hashSha256, resultado.periodo.inicio, resultado.periodo.fim, resultado.cabecalho.cnpj);
      } catch (erroLote) {
        if (/UNIQUE/i.test(erroLote.message)) return ok(res, { status: 'DUPLICADO', mensagem: 'Este arquivo EFD-Contribuições já foi importado para a empresa.' });
        throw erroLote;
      }
    } else {
      lote = db.prepare(`INSERT INTO lotes (empresa_id, tipo, arquivo, registros, origem)
        VALUES (?,?,?,0,'sped')`).run(req.params.id, 'sped', arquivos.map((a) => a.originalname).join(', ').slice(0, 200));
    }

    const insMov = db.prepare(`INSERT INTO movimentos (empresa_id, lote_id, tipo, sentido, nome, inscr_federal,
      descricao, ncm, nbs, cfop, cst, csosn, competencia, documento, chave, item_numero, codigo_produto,
      quantidade, unidade, data_emissao, emitente_cnpj, destinatario_cnpj,
      valor, base_calculo, icms, icms_st, ipi, pis, cofins, iss, frete, seguro, outras, desconto, origem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'sped')`);
    const insPar = db.prepare(`INSERT INTO parceiros (empresa_id, tipo, cnpj, descricao, regime, municipio, origem)
      VALUES (?,?,?,?,'',?, 'sped')
      ON CONFLICT(empresa_id, tipo, cnpj) DO UPDATE SET descricao = excluded.descricao`);

    const rel = { arquivos: arquivos.length, periodos: [], itens: 0, entradas: 0, saidas: 0,
      participantes: 0, produtos: 0, avisos: [], erros: [] };

    db.transaction(() => {
      for (const { arquivo: f } of preparados) {
        try {
          const r = sped.lerSped(f.buffer, empresa.cnpj);
          rel.periodos.push({ arquivo: f.originalname, tipo: r.tipoArquivo,
            inicio: r.periodo.inicio, fim: r.periodo.fim, ...r.resumo });
          rel.produtos += r.produtos;
          r.avisos.forEach((a) => { if (!rel.avisos.includes(a)) rel.avisos.push(a); });

          // Participantes: o lado (fornecedor/cliente) vem do sentido dos documentos
          const lados = new Map();
          for (const i of r.itens) {
            if (!i.inscr_federal) continue;
            const k = `${i.inscr_federal}|${i.tipo}`;
            if (!lados.has(k)) lados.set(k, { cnpj: i.inscr_federal, nome: i.nome, tipo: i.tipo });
          }
          for (const p of lados.values()) {
            insPar.run(req.params.id, p.tipo, p.cnpj, p.nome || p.cnpj, '');
            rel.participantes++;
          }

          for (const i of r.itens) {
            insMov.run(req.params.id, lote.lastInsertRowid, i.tipo, i.sentido, i.nome, i.inscr_federal,
              i.descricao, i.ncm || '', i.nbs || '', i.cfop || '', i.cst || '', '', i.competencia,
              i.documento, i.chave || '', i.item_numero, i.codigo_produto || '', i.quantidade || 0,
              i.unidade || '', i.data_emissao || '', i.emitente_cnpj || '', i.destinatario_cnpj || '',
              i.valor, i.base_calculo || i.valor, i.icms || 0, i.icms_st || 0, i.ipi || 0,
              i.pis || 0, i.cofins || 0, i.iss || 0, i.frete || 0, i.seguro || 0, i.outras || 0, i.desconto || 0);
            rel.itens++;
            if (i.sentido === 'entrada') rel.entradas++; else rel.saidas++;
          }
        } catch (e) { rel.erros.push(`${f.originalname}: ${e.message}`); }
      }
    })();

    db.prepare(`UPDATE lotes SET registros = ?, status_importacao = CASE WHEN tipo_arquivo='EFD_CONTRIBUICOES' THEN ? ELSE status_importacao END, mensagens = CASE WHEN tipo_arquivo='EFD_CONTRIBUICOES' THEN ? ELSE mensagens END WHERE id = ?`).run(rel.itens, rel.erros.length ? 'ERRO' : 'IMPORTADO', rel.erros.length ? rel.erros.join('\n').slice(0, 1000) : null, lote.lastInsertRowid);
    let classificacao = null;
    try {
      const tem = db.prepare('SELECT (SELECT COUNT(*) FROM base_ncm) + (SELECT COUNT(*) FROM base_servicos) c').get().c;
      if (tem) classificacao = bases.classificarMovimentos(req.params.id);
    } catch (_) { /* segue sem classificar */ }
    const semRegime = db.prepare(`SELECT COUNT(*) c FROM parceiros WHERE empresa_id = ? AND (regime IS NULL OR regime = '')`).get(req.params.id).c;
    const enriquecimento = agendarEnriquecimentoAutomatico(req.params.id);
    ok(res, { ...rel, classificacao, parceirosSemRegime: semRegime,
      enriquecimento: { status: enriquecimento.status, mensagem: 'CNPJs pendentes foram enviados para enriquecimento automático.' } });
  } catch (e) { erro(res, e); }
});

/** Mapa de riscos derivado do motor */
router.get('/empresas/:id/motor/riscos', (req, res) => {
  try {
    const r = motorExec.executar(req.params.id, { ano: req.query.ano, gravar: false });
    const mapa = mapaRiscos.montar(r, {
      fornecedores: motorExec.porFornecedor(r), clientes: motorExec.porCliente(r),
    });
    ok(res, mapa);
  } catch (e) { erro(res, e); }
});

/** Leva os riscos para o plano de adequação, sem duplicar o que já existe */
router.post('/empresas/:id/motor/riscos/plano', (req, res) => {
  try {
    const r = motorExec.executar(req.params.id, { ano: req.body.ano, gravar: false });
    const mapa = mapaRiscos.montar(r, {
      fornecedores: motorExec.porFornecedor(r), clientes: motorExec.porCliente(r),
    });
    const existentes = new Set(db.prepare('SELECT titulo FROM acoes WHERE empresa_id = ?')
      .all(req.params.id).map((a) => a.titulo));
    const ins = db.prepare(`INSERT INTO acoes (empresa_id, origem, titulo, descricao, prioridade, status)
      VALUES (?,?,?,?,?, 'aberta')`);
    let criadas = 0, ignoradas = 0;
    db.transaction(() => {
      for (const a of mapaRiscos.acoesSugeridas(mapa)) {
        if (existentes.has(a.titulo)) { ignoradas++; continue; }
        ins.run(req.params.id, a.origem, a.titulo, a.descricao, a.prioridade);
        criadas++;
      }
    })();
    ok(res, { criadas, ignoradas });
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// CONFIGURAÇÕES — REGRAS DE CÁLCULO
// ===========================================================================
router.get('/config/controle', (_req, res) => {
  try {
    const empresas = db.prepare('SELECT id, razao_social FROM empresas ORDER BY razao_social').all();
    const porEmpresa = empresas.map((e) => {
      const cadastro = db.prepare(`SELECT COUNT(*) parceiros, SUM(CASE WHEN tipo='cliente' AND (regime IS NULL OR regime='' OR regime='indeterminado') THEN 1 ELSE 0 END) clientes_pendentes
        FROM parceiros WHERE empresa_id=?`).get(e.id);
      const receitaPendente = db.prepare(`SELECT COALESCE(SUM(m.valor),0) valor FROM movimentos m
        LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo AND p.cnpj=m.inscr_federal
        WHERE m.empresa_id=? AND m.tipo='cliente' AND (p.regime IS NULL OR p.regime='' OR p.regime='indeterminado')`).get(e.id).valor;
      const classificacao = db.prepare(`SELECT COUNT(*) c FROM movimentos WHERE empresa_id=?
        AND (cclasstrib IS NULL OR cclasstrib='' OR classificacao_origem='requer_decisao')`).get(e.id).c;
      const referencias = new Set(db.prepare('SELECT chave FROM empresa_servicos_fiscais WHERE empresa_id=? AND ativo=1').all(e.id).map((r) => r.chave));
      const servicosSemReferencia = db.prepare(`SELECT nbs, ncm, iss, pis, cofins, descricao, valor FROM movimentos WHERE empresa_id=? AND tipo='cliente'`).all(e.id)
        .filter(requerReferenciaFiscalServico).filter((m) => !referencias.has(chaveReferenciaServico(m)));
      const execucao = motorExec.ultimaExecucao(e.id);
      const excecoes = excecoesMotor.resumo(e.id);
      return { ...e, parceiros: cadastro.parceiros || 0, clientesPendentes: cadastro.clientes_pendentes || 0,
        receitaPendente: receitaPendente || 0, classificacoesPendentes: classificacao || 0,
        servicosSemReferencia: servicosSemReferencia.length,
        vendasSemReferencia: servicosSemReferencia.reduce((s, m) => s + (Number(m.valor) || 0), 0),
        ultimaExecucao: execucao && { data: execucao.criado_em, ano: execucao.ano, itens: execucao.itens },
        enriquecimento: cnpjReceita.statusFila(e.id), excecoes };
    });
    const total = porEmpresa.reduce((a, x) => ({ clientesPendentes: a.clientesPendentes + x.clientesPendentes,
      receitaPendente: a.receitaPendente + x.receitaPendente, classificacoesPendentes: a.classificacoesPendentes + x.classificacoesPendentes,
      servicosSemReferencia: a.servicosSemReferencia + x.servicosSemReferencia, vendasSemReferencia: a.vendasSemReferencia + x.vendasSemReferencia,
      excecoesAbertas: a.excecoesAbertas + (x.excecoes?.abertas || 0), valorExcecoes: a.valorExcecoes + (x.excecoes?.valor_envolvido || 0) }),
      { clientesPendentes: 0, receitaPendente: 0, classificacoesPendentes: 0, servicosSemReferencia: 0, vendasSemReferencia: 0, excecoesAbertas: 0, valorExcecoes: 0 });
    ok(res, { total, empresas: porEmpresa });
  } catch (e) { erro(res, e); }
});

router.post('/config/controle/enriquecer', (_req, res) => {
  try {
    const filas = db.prepare('SELECT id FROM empresas').all().map((e) => cnpjReceita.agendarEnriquecimento(e.id));
    ok(res, { filas: filas.map((f) => ({ empresa_id: f.empresa_id, status: f.status })) });
  } catch (e) { erro(res, e); }
});

router.post('/config/processamentos-carteira', async (_req, res) => {
  try { ok(res, { processamento: await processamentoCarteira.iniciar({ tipo: 'RECALCULO_INCREMENTAL' }) }); }
  catch (e) { erro(res, e); }
});
function consultarProcessamentoCarteira(req, res) {
  try {
    const processamento = req.params.id ? processamentoCarteira.consultar(req.params.id) : processamentoCarteira.ultimo();
    ok(res, { processamento });
  } catch (e) { erro(res, e); }
}
// Express 5 / path-to-regexp não aceita mais o modificador ? em parâmetros.
// Mantemos as duas URLs públicas, com handlers explícitos.
router.get('/config/processamentos-carteira', consultarProcessamentoCarteira);
router.get('/config/processamentos-carteira/:id', consultarProcessamentoCarteira);
router.post('/config/processamentos-carteira/jobs/:id/cancelar', async (req, res) => {
  try { ok(res, await processamentoCarteira.cancelar(req.params.id)); }
  catch (e) { erro(res, e); }
});

// Central de exceções: não cria cálculo novo. Mostra somente o que o motor
// não conseguiu resolver automaticamente, em ordem de materialidade.
router.get('/empresas/:id/excecoes', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    ok(res, { excecoes: excecoesMotor.listar(req.params.id, req.query), resumo: excecoesMotor.resumo(req.params.id) });
  } catch (e) { erro(res, e); }
});
router.get('/empresas/:id/autonomia', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    ok(res, autonomiaTelemetry.obter(db, Number(req.params.id)));
  } catch (e) { erro(res, e); }
});

// Fase 2A — leitura consolidada da cobertura. A rota não roda motor, não
// reclassifica e não converte ausência de evidência em zero.
router.get('/empresas/:id/cobertura-diagnostico', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    ok(res, coberturaDiagnostico.fotografia(Number(req.params.id)));
  } catch (e) { erro(res, e); }
});
router.post('/empresas/:id/cobertura-diagnostico/fotografias', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    ok(res, coberturaDiagnostico.registrarFotografia(Number(req.params.id), req.body?.tipo || 'FASE_2A'));
  } catch (e) { erro(res, e); }
});
router.get('/empresas/:id/cobertura-diagnostico/fotografias', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    ok(res, { fotografias: coberturaDiagnostico.listarFotografias(Number(req.params.id)) });
  } catch (e) { erro(res, e); }
});
router.post('/config/cadastros-mestre/popular', async (_req, res) => {
  try { ok(res, coberturaDiagnostico.popularCadastrosMestre()); } catch (e) { erro(res, e); }
});

router.get('/config/regras', async (_req, res) => {
  try {
    // Esta é a rota que alimenta a tela de Configurações. Ela consulta a
    // fonte compartilhada antes de montar o formulário, nunca um cache antigo.
    if (supabase.configurado()) await require('../services/operacaoCompartilhada').baixarConfiguracao(['param_aliquotas','param_regimes']);
    regras.invalidar();
    const local = db.prepare('SELECT ano,cbs,ibs,calcular_ibs,atualizado_em FROM param_aliquotas WHERE ano=2027').get() || null;
    const auditoria = { cache_render: local, supabase_configurado: supabase.configurado(),
      modo_operacao_compartilhada: process.env.SUPABASE_OPERACAO_COMPARTILHADA !== 'false',
      commit_render: process.env.RENDER_GIT_COMMIT || null, fonte_supabase: null, erro_supabase: null };
    if (supabase.configurado()) {
      try {
        const { data, error } = await supabase.admin().from('parametros_operacionais').select('dados').eq('tabela', 'configuracao').eq('chave', 'param_aliquotas').maybeSingle();
        if (error) throw error;
        const referencia = (data?.dados || []).find((x) => Number(x.ano) === 2027) || null;
        auditoria.fonte_supabase = referencia ? { ano: referencia.ano, cbs: referencia.cbs, ibs: referencia.ibs, calcular_ibs: referencia.calcular_ibs } : null;
      } catch (e) { auditoria.erro_supabase = e.message; }
    }
    const simplesLocal = db.prepare("SELECT pis_cofins,credito_cbs_simples_referencia FROM param_regimes WHERE chave='simples_nacional'").get() || null;
    const auditoriaRegimeSimples = { cache_render: simplesLocal, supabase_configurado: supabase.configurado(), fonte_supabase: null, erro_supabase: null };
    if (supabase.configurado()) try {
      const { data, error } = await supabase.admin().from('parametros_operacionais').select('dados').eq('tabela', 'configuracao').eq('chave', 'param_regimes').maybeSingle();
      if (error) throw error;
      const r = (data?.dados || []).find((x) => x.chave === 'simples_nacional') || null;
      auditoriaRegimeSimples.fonte_supabase = r ? { pis_cofins: r.pis_cofins, credito_cbs_simples_referencia: r.credito_cbs_simples_referencia ?? null } : null;
    } catch (e) { auditoriaRegimeSimples.erro_supabase = e.message; }
    ok(res, { ...regras.tudo(), auditoria, auditoriaRegimeSimples });
  } catch (e) { erro(res, e); }
});

/**
 * Recalcula tudo o que fica persistido. Projeções, cenários e relatórios já
 * calculam sob demanda com as regras atuais; Classificações e Precificação
 * guardam resultado no banco e precisam desta atualização explícita.
 */
router.post('/config/recalcular', async (_req, res) => {
  try {
    // Um recálculo precisa sempre partir da fonte compartilhada das regras.
    // Sem esta carga, uma instância do Render pode usar o cache iniciado antes
    // da alteração do crédito CBS do Simples.
    if (supabase.configurado()) {
      await require('../services/operacaoCompartilhada').baixarConfiguracao(['param_regimes','param_aliquotas','param_regras','param_reducoes','param_simples']);
      regras.invalidar();
    }
    const empresas = db.prepare('SELECT * FROM empresas ORDER BY id').all();
    const saida = { empresas: empresas.length, motores: 0, movimentos: 0, itensPrecificacao: 0, erros: [] };

    for (const empresa of empresas) {
      try {
        // Garante que regras de natureza/classificação também sejam aplicadas
        // antes da nova projeção, sem depender de uma ação manual separada.
        const classificacao = bases.classificarMovimentos(empresa.id);
        saida.movimentos += classificacao.total || 0;

        const ultima = db.prepare('SELECT ano FROM motor_execucoes WHERE empresa_id = ? ORDER BY id DESC LIMIT 1').get(empresa.id);
        motorExec.executar(empresa.id, { ano: ultima ? ultima.ano : 2027, integral: true });
        saida.motores++;

        // Itens de precificação legados não são recalculados. A visão oficial
        // é montada sob demanda a partir de motor_resultados + formação de custo.
      } catch (e) {
        saida.erros.push({ empresa_id: empresa.id, empresa: empresa.razao_social, erro: e.message });
      }
    }
    ok(res, saida);
  } catch (e) { erro(res, e); }
});

// Parâmetros fiscais são críticos: a confirmação só é devolvida depois de a
// mesma versão estar gravada na fonte compartilhada. Isso impede que um
// reinício do Render recupere um valor antigo e altere o cálculo silenciosamente.
async function confirmarParametrosCompartilhados() {
  const operacao = require('../services/operacaoCompartilhada');
  await operacao.publicarConfiguracao();
}
router.put('/config/regras/:grupo/:chave', async (req, res) => {
  try { regras.salvarRegra(req.params.grupo, req.params.chave, req.body.valor, req.body.usuario); await confirmarParametrosCompartilhados(); ok(res, {}); }
  catch (e) { erro(res, e); }
});

router.put('/config/tributos/:chave', async (req, res) => {
  try { regras.salvarTributo(req.params.chave, req.body, req.body.usuario); await confirmarParametrosCompartilhados(); ok(res, {}); }
  catch (e) { erro(res, e); }
});

router.put('/config/regimes/:chave', async (req, res) => {
  try { regras.salvarRegime(req.params.chave, req.body, req.body.usuario); await confirmarParametrosCompartilhados(); ok(res, {}); }
  catch (e) { erro(res, e); }
});

router.put('/config/reducoes/:chave', async (req, res) => {
  try { regras.salvarReducao(req.params.chave, req.body, req.body.usuario); await confirmarParametrosCompartilhados(); ok(res, {}); }
  catch (e) { erro(res, e); }
});

router.put('/config/aliquotas/:ano', async (req, res) => {
  try { regras.salvarAliquota(Number(req.params.ano), req.body, req.body.usuario); await confirmarParametrosCompartilhados(); ok(res, {}); }
  catch (e) { erro(res, e); }
});

router.put('/config/simples/:anexo/:faixa', async (req, res) => {
  try { regras.salvarSimples(req.params.anexo, Number(req.params.faixa), req.body, req.body.usuario); await confirmarParametrosCompartilhados(); ok(res, {}); }
  catch (e) { erro(res, e); }
});

router.put('/config/cfop/:id', async (req, res) => {
  try { regras.salvarCfop(Number(req.params.id), req.body, req.body.usuario); await confirmarParametrosCompartilhados(); ok(res, {}); }
  catch (e) { erro(res, e); }
});

router.get('/config/historico', (req, res) => {
  try { ok(res, { historico: regras.historico(req.query.limite) }); } catch (e) { erro(res, e); }
});

/** Testa uma regra sem gravar: simula uma operação com os valores informados */
router.post('/config/simular', (req, res) => {
  try {
    const { reconstruir } = require('../engine/reconstrucao');
    const rec = reconstruir(req.body);
    ok(res, { reconstrucao: rec });
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// CENÁRIOS — SIMULAÇÃO DA CADEIA POR GRUPOS E PERCENTUAIS
// ===========================================================================
router.get('/cenarios/dimensoes', (_req, res) => {
  try {
    ok(res, {
      compras: dimensoes.dimensoesDoLado('compras').map((d) => ({ chave: d.chave, nome: d.nome, tipo: d.tipo, descricao: d.descricao, grupos: d.grupos })),
      vendas: dimensoes.dimensoesDoLado('vendas').map((d) => ({ chave: d.chave, nome: d.nome, tipo: d.tipo, descricao: d.descricao, grupos: d.grupos })),
    });
  } catch (e) { erro(res, e); }
});

/** Cenário base: fotografia econômica atual, imutável */
router.get('/empresas/:id/cenarios/base', (req, res) => {
  try {
    const ano = Number(req.query.ano) || 2033;
    const cen = cenarioMotor.obterOuCriarBase(req.params.id, ano);
    const r = cenarioMotor.executarCenario(cen.id);
    ok(res, { cenario: cen, composicao: r.composicao, indicadores: r.indicadores,
      apuracao: r.apuracao, resumo: r.resumo });
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/cenarios/lista', (req, res) => ok(res, {
  cenarios: db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM cenario_premissas p WHERE p.cenario_id = c.id) premissas,
      (SELECT COUNT(*) FROM cenario_alocacoes a WHERE a.cenario_id = c.id) alocacoes
    FROM cenarios c WHERE c.empresa_id = ? ORDER BY c.tipo DESC, c.id DESC`).all(req.params.id),
}));

router.post('/empresas/:id/cenarios', (req, res) => {
  try {
    const b = req.body;
    const ano = Number(b.ano) || 2033;
    const base = cenarioMotor.obterOuCriarBase(req.params.id, ano);
    const r = db.prepare(`INSERT INTO cenarios (empresa_id, nome, descricao, tipo, base_id, versao, ano, status)
      VALUES (?,?,?, 'hipotese', ?, 1, ?, 'rascunho')`)
      .run(req.params.id, b.nome || 'Novo cenário', b.descricao || '', base.id, ano);
    // duplicar premissas e alocações de outro cenário, quando pedido
    if (b.duplicar_de) {
      db.prepare(`INSERT INTO cenario_premissas (cenario_id, nivel, lado, dimensao, grupo,
        entidade_tipo, entidade_id, campo, valor_original, valor_simulado, justificativa, fonte)
        SELECT ?, nivel, lado, dimensao, grupo, entidade_tipo, entidade_id, campo,
          valor_original, valor_simulado, justificativa, fonte
        FROM cenario_premissas WHERE cenario_id = ?`).run(r.lastInsertRowid, b.duplicar_de);
      db.prepare(`INSERT INTO cenario_alocacoes (cenario_id, lado, dimensao, grupo_origem,
        grupo_destino, percentual_grupo, variacao_preco, justificativa)
        SELECT ?, lado, dimensao, grupo_origem, grupo_destino, percentual_grupo, variacao_preco, justificativa
        FROM cenario_alocacoes WHERE cenario_id = ?`).run(r.lastInsertRowid, b.duplicar_de);
    }
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

/** Nova versão de um cenário já calculado — cenário calculado é imutável */
router.post('/cenarios/:id/versao', (req, res) => {
  try {
    const c = db.prepare('SELECT * FROM cenarios WHERE id = ?').get(req.params.id);
    if (!c) throw new Error('Cenário não encontrado.');
    const r = db.prepare(`INSERT INTO cenarios (empresa_id, nome, descricao, tipo, base_id,
      versao, versao_anterior_id, ano, status) VALUES (?,?,?,?,?,?,?,?, 'rascunho')`)
      .run(c.empresa_id, req.body.nome || `${c.nome} v${c.versao + 1}`, c.descricao,
        c.tipo, c.base_id, c.versao + 1, c.id, c.ano);
    db.prepare(`INSERT INTO cenario_premissas (cenario_id, nivel, lado, dimensao, grupo,
      entidade_tipo, entidade_id, campo, valor_original, valor_simulado, justificativa, fonte)
      SELECT ?, nivel, lado, dimensao, grupo, entidade_tipo, entidade_id, campo,
        valor_original, valor_simulado, justificativa, fonte
      FROM cenario_premissas WHERE cenario_id = ?`).run(r.lastInsertRowid, c.id);
    db.prepare(`INSERT INTO cenario_alocacoes (cenario_id, lado, dimensao, grupo_origem,
      grupo_destino, percentual_grupo, variacao_preco, justificativa)
      SELECT ?, lado, dimensao, grupo_origem, grupo_destino, percentual_grupo, variacao_preco, justificativa
      FROM cenario_alocacoes WHERE cenario_id = ?`).run(r.lastInsertRowid, c.id);
    ok(res, { id: r.lastInsertRowid, versao: c.versao + 1 });
  } catch (e) { erro(res, e); }
});

/** Migração percentual entre grupos da mesma dimensão */
router.post('/cenarios/:id/alocacoes', (req, res) => {
  try {
    const b = req.body;
    if (!b.dimensao || !b.grupo_origem || !b.grupo_destino) throw new Error('Informe dimensão, grupo de origem e grupo de destino.');
    if (b.grupo_origem === b.grupo_destino) throw new Error('Origem e destino não podem ser o mesmo grupo.');
    const p = Number(b.percentual_grupo);
    if (!(p > 0 && p <= 1)) throw new Error('O percentual do grupo a migrar deve estar entre 0 e 1 (0,40 = 40% do grupo).');

    // participação do grupo de origem no cenário base, para registrar o impacto
    const cen = db.prepare('SELECT * FROM cenarios WHERE id = ?').get(req.params.id);
    const comp = db.prepare(`SELECT participacao, valor FROM cenario_composicao
      WHERE cenario_id = ? AND lado = ? AND dimensao = ? AND grupo = ?`)
      .get(cen.base_id || cen.id, b.lado, b.dimensao, b.grupo_origem);
    const participacao = comp ? comp.participacao : null;

    const r = db.prepare(`INSERT INTO cenario_alocacoes (cenario_id, lado, dimensao, grupo_origem,
      grupo_destino, percentual_grupo, participacao_origem, percentual_total, valor_afetado,
      variacao_preco, justificativa) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.params.id, b.lado, b.dimensao, b.grupo_origem, b.grupo_destino, p,
        participacao, participacao !== null ? participacao * p : null,
        comp ? comp.valor * p : null, Number(b.variacao_preco) || 0, b.justificativa || '');
    db.prepare(`UPDATE cenarios SET status = 'rascunho' WHERE id = ?`).run(req.params.id);
    ok(res, { id: r.lastInsertRowid,
      participacaoOrigem: participacao,
      percentualTotal: participacao !== null ? participacao * p : null,
      valorAfetado: comp ? comp.valor * p : null });
  } catch (e) { erro(res, e); }
});

router.get('/cenarios/:id/alocacoes', (req, res) => ok(res, {
  alocacoes: db.prepare('SELECT * FROM cenario_alocacoes WHERE cenario_id = ? ORDER BY id').all(req.params.id),
  premissas: db.prepare('SELECT * FROM cenario_premissas WHERE cenario_id = ? ORDER BY id').all(req.params.id),
}));

router.delete('/cenarios/alocacoes/:id', (req, res) => {
  const a = db.prepare('SELECT cenario_id FROM cenario_alocacoes WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM cenario_alocacoes WHERE id = ?').run(req.params.id);
  if (a) db.prepare(`UPDATE cenarios SET status = 'rascunho' WHERE id = ?`).run(a.cenario_id);
  ok(res, {});
});

/** Premissa global, por grupo ou individual */
const CAMPOS_PREMISSA_CENARIO = new Set(['regime', 'variacao_preco', 'rbt12', 'anexo_simples', 'hibrido', 'grau_repasse', 'estrategia_preco']);
const CAMPOS_FISCAIS_PROTEGIDOS_CENARIO = new Set(['ncm', 'nbs', 'cst', 'cclasstrib', 'tratamento_fiscal', 'status_classificacao', 'classificacao']);
router.post('/cenarios/:id/premissas', (req, res) => {
  try {
    const b = req.body;
    if (!['global', 'grupo', 'individual'].includes(b.nivel)) throw new Error('Nível deve ser global, grupo ou individual.');
    if (!b.campo) throw new Error('Informe o campo da premissa.');
    if (CAMPOS_FISCAIS_PROTEGIDOS_CENARIO.has(b.campo)) {
      throw new Error('NCM, NBS, CST, cClassTrib, tratamento e status fiscal não podem ser alterados por uma premissa comercial de cenário.');
    }
    if (!CAMPOS_PREMISSA_CENARIO.has(b.campo)) {
      throw new Error('Campo de premissa não suportado neste cenário. Use regime, variação de preço, faixa/anexo do Simples, híbrido ou grau de repasse.');
    }
    const r = db.prepare(`INSERT INTO cenario_premissas (cenario_id, nivel, lado, dimensao, grupo,
      entidade_tipo, entidade_id, campo, valor_original, valor_simulado, justificativa, fonte)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.params.id, b.nivel, b.lado || null, b.dimensao || null, b.grupo || null,
        b.entidade_tipo || null, b.entidade_id || null, b.campo,
        b.valor_original || null, String(b.valor_simulado), b.justificativa || '', b.fonte || '');
    db.prepare(`UPDATE cenarios SET status = 'rascunho' WHERE id = ?`).run(req.params.id);
    ok(res, { id: r.lastInsertRowid });
  } catch (e) { erro(res, e); }
});

router.delete('/cenarios/premissas/:id', (req, res) => {
  const p = db.prepare('SELECT cenario_id FROM cenario_premissas WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM cenario_premissas WHERE id = ?').run(req.params.id);
  if (p) db.prepare(`UPDATE cenarios SET status = 'rascunho' WHERE id = ?`).run(p.cenario_id);
  ok(res, {});
});

/** Catálogo de hipóteses A–H. Retorna configuração, nunca resultado calculado. */
router.get('/cenarios/templates', (_req, res) => ok(res, { templates: cenarioTemplates.listar() }));

/**
 * Materializa um template como cenário normal e editável. A gravação das
 * premissas usa a mesma tabela/contrato da composição manual.
 */
router.post('/empresas/:id/cenarios/templates/:chave', (req, res) => {
  try {
    const tpl = cenarioTemplates.obter(req.params.chave);
    if (!tpl) throw new Error('Template de cenário não encontrado.');
    const ano = Number(req.body.ano) || 2033;
    const base = cenarioMotor.obterOuCriarBase(req.params.id, ano);
    if (tpl.base) return ok(res, { id: base.id, base: true, nome: tpl.nome });
    // H não muda regime automaticamente: a confirmação é uma decisão do
    // consultor e a regra legal continua no motor.
    if (tpl.exigeSimples && !req.body.confirmar_simples) {
      throw new Error('O cenário H exige confirmação explícita de que a comparação é juridicamente cabível para a empresa analisada.');
    }
    const r = db.prepare(`INSERT INTO cenarios (empresa_id,nome,descricao,tipo,base_id,versao,ano,status,parametros)
      VALUES (?,?,?,'hipotese',?,1,?,'rascunho',?)`).run(
      req.params.id, `${tpl.codigo} — ${tpl.nome}`, tpl.descricao, base.id, ano,
      JSON.stringify({ template: tpl.chave, fase: '2C', editavel: true }));
    const ins = db.prepare(`INSERT INTO cenario_premissas
      (cenario_id,nivel,lado,dimensao,grupo,entidade_tipo,entidade_id,campo,valor_original,valor_simulado,justificativa,fonte,natureza)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'SIMULADO')`);
    db.transaction(() => (tpl.premissas || []).forEach((p) => ins.run(r.lastInsertRowid, p.nivel, p.lado || null,
      p.dimensao || null, p.grupo || null, null, null, p.campo, null, String(p.valor_simulado),
      p.justificativa || '', p.fonte || 'TEMPLATE_2C')))();
    ok(res, { id: r.lastInsertRowid, template: tpl.chave, editavel: true });
  } catch (e) { erro(res, e); }
});

/** Executa o cenário e devolve composição, indicadores e efeitos */
router.post('/cenarios/:id/executar', (req, res) => {
  try {
    const r = cenarioMotor.executarCenario(req.params.id);
    ok(res, {
      cenario: r.cenario, composicao: r.composicao, indicadores: r.indicadores,
      apuracao: r.apuracao, efeitos: r.efeitos || null, indiceMudanca: r.indiceMudanca || null,
      base: r.base || null,
      migracoes: r.migracoes ? r.migracoes.length : 0,
      reconciliacao: {
        compras: cenarioMemoria.reconciliar(r, 'compras'),
        vendas: cenarioMemoria.reconciliar(r, 'vendas'),
      },
    });
  } catch (e) { erro(res, e); }
});

/** Etapa 5: indicadores, alertas e matriz exclusivamente derivados do cenário executado. */
router.get('/cenarios/:id/analitica', (req, res) => {
  try {
    const r = cenarioMotor.executarCenario(req.params.id);
    ok(res, { cenario:{ id:r.cenario.id, nome:r.cenario.nome, tipo:r.cenario.tipo, ano:r.ano },
      analise:analiseCadeia.analisar(r) });
  } catch (e) { erro(res, e); }
});

/**
 * Saída executiva: organiza exclusivamente a fotografia já calculada pelos
 * cenários oficiais. Nenhuma regra fiscal é executada aqui além da chamada ao
 * mesmo orquestrador que também sustenta as telas de cenários.
 */
function idsSaidaExecutiva(req) {
  const bruto = req.method === 'GET' ? String(req.query.cenarios || '').split(',') : (req.body?.cenario_ids || []);
  return [...new Set((Array.isArray(bruto) ? bruto : []).map(Number).filter(Boolean))];
}
function montarSaidaExecutiva(empresaId, ids, anoSolicitado) {
  const cenarios = db.prepare(`SELECT id,empresa_id,tipo,ano FROM cenarios WHERE empresa_id=?`).all(empresaId);
  const permitidos = new Set(cenarios.map((x) => Number(x.id)));
  const escolhidos = cenarios.filter((x) => ids.includes(Number(x.id)));
  const ano = Number(anoSolicitado) || Number(escolhidos[0]?.ano) || 2027;
  if (escolhidos.some((x) => Number(x.ano) !== ano)) throw new Error('Selecione cenários da mesma referência para a apresentação.');
  const base = cenarios.find((x) => x.tipo === 'base' && Number(x.ano) === ano);
  const selecionados = [...new Set([base?.id, ...ids].filter(Boolean).map(Number))];
  if (!base) throw new Error(`Cenário base ${ano} não encontrado para esta empresa.`);
  if (selecionados.some((id) => !permitidos.has(id))) throw new Error('Há cenário selecionado que não pertence à empresa em análise.');
  if (selecionados.length > 5) throw new Error('Selecione o cenário base e no máximo quatro hipóteses.');
  return saidaExecutiva.montar(selecionados.map((id) => cenarioMotor.executarCenario(id)));
}
router.post('/empresas/:id/saida-executiva', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    ok(res, { relatorio:montarSaidaExecutiva(Number(req.params.id), idsSaidaExecutiva(req), req.body?.ano) });
  } catch (e) { erro(res, e); }
});
router.get('/empresas/:id/saida-executiva.pdf', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    const relatorio = montarSaidaExecutiva(Number(req.params.id), idsSaidaExecutiva(req), req.query.ano);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="diagnostico-executivo-cbs.pdf"');
    saidaExecutiva.gerarPdf(relatorio, res);
  } catch (e) { erro(res, e); }
});

/** Memória de cálculo do grupo — nível 1 */
router.get('/cenarios/:id/memoria/:lado/:dimensao/:grupo', (req, res) => {
  try {
    const r = cenarioMotor.executarCenario(req.params.id);
    ok(res, { memoria: cenarioMemoria.memoriaGrupo(r, req.params.lado, req.params.dimensao, req.params.grupo) });
  } catch (e) { erro(res, e); }
});

/** Drill-down do grupo até o documento — nível 2 */
router.get('/cenarios/:id/drilldown/:lado/:dimensao/:grupo', (req, res) => {
  try {
    const r = cenarioMotor.executarCenario(req.params.id);
    ok(res, { itens: cenarioMemoria.drillDown(r, req.params.lado, req.params.dimensao,
      req.params.grupo, Number(req.query.limite) || 300) });
  } catch (e) { erro(res, e); }
});

/** Comparação lado a lado de 2 a 5 cenários */
router.post('/cenarios/comparar', (req, res) => {
  try {
    const solicitados = req.body.ids || [];
    if (solicitados.length > 5) throw new Error('Selecione no máximo cinco cenários para a comparação.');
    const ids = [...new Set(solicitados.map(Number).filter(Boolean))];
    if (ids.length < 2) throw new Error('Selecione ao menos dois cenários.');
    const linhas = ids.map((id) => {
      const r = cenarioMotor.executarCenario(id);
      return { id, nome: r.cenario.nome, tipo: r.cenario.tipo, ano: r.ano,
        indicadores: r.indicadores, apuracao: r.apuracao,
        efeitos: r.efeitos || null, indiceMudanca: r.indiceMudanca || null,
        composicao: r.composicao,
        drilldown: { cenario_id: id, disponivel: true } };
    });
    const referencia = linhas.find((x) => x.tipo === 'base') || linhas[0];
    for (const linha of linhas) {
      const b = referencia.indicadores;
      const i = linha.indicadores;
      linha.efeitoEconomico = {
        credito_adicional: r2(i.creditoRecebido - b.creditoRecebido),
        alteracao_custo_bruto: r2(i.comprasProjetadas - b.comprasProjetadas),
        ganho_perda_custo_efetivo: r2(b.custoEfetivoCompras - i.custoEfetivoCompras),
      };
    }
    ok(res, { cenarios: linhas });
  } catch (e) { erro(res, e); }
});

router.delete('/cenarios/:id', (req, res) => {
  const c = db.prepare('SELECT tipo FROM cenarios WHERE id = ?').get(req.params.id);
  if (c && c.tipo === 'base') return erro(res, new Error('O cenário base não pode ser excluído.'));
  db.prepare('DELETE FROM cenarios WHERE id = ?').run(req.params.id);
  ok(res, {});
});

// ===========================================================================
// CONSULTA DE REGIME NA BASE DA RECEITA
// ===========================================================================
router.get('/cnpj/config', (_req, res) => {
  try {
    const c = cnpjReceita.config();
    ok(res, { config: { provedor: c.provedor, nome: c.nome, ativo: !!c.ativo,
      validade_dias: c.validade_dias, intervalo: c.intervalo, site: c.site,
      exigeChave: c.exigeChave, temToken: !!c.token },
      cache: cnpjReceita.estatisticasCache() });
  } catch (e) { erro(res, e); }
});

router.post('/cnpj/config', (req, res) => {
  try { cnpjReceita.salvarConfig(req.body); ok(res, { config: cnpjReceita.config().provedor }); }
  catch (e) { erro(res, e); }
});

/** Consulta avulsa — útil para conferir um fornecedor específico */
router.get('/cnpj/:cnpj', async (req, res) => {
  try { ok(res, { resultado: await cnpjReceita.consultar(req.params.cnpj, { forcar: req.query.forcar === '1' }) }); }
  catch (e) { erro(res, e); }
});

/** Quanto falta enriquecer e quanto tempo levaria */
router.get('/empresas/:id/parceiros/pendencias-regime', (req, res) => {
  try { ok(res, cnpjReceita.pendencias(req.params.id)); } catch (e) { erro(res, e); }
});

/** Enriquecimento em lote dos parceiros sem regime */
router.post('/empresas/:id/parceiros/enriquecer', async (req, res) => {
  try {
    const r = await cnpjReceita.enriquecerParceiros(req.params.id, {
      tipo: req.body.tipo, limite: req.body.limite,
      sobrescrever: !!req.body.sobrescrever, forcar: !!req.body.forcar });
    // reclassifica a movimentação com os regimes recém-descobertos
    let classificacao = null;
    try {
      const tem = db.prepare('SELECT (SELECT COUNT(*) FROM base_ncm) + (SELECT COUNT(*) FROM base_servicos) c').get().c;
      if (tem) classificacao = bases.classificarMovimentos(req.params.id);
    } catch (_) { /* segue */ }
    ok(res, { ...r, classificacao });
  } catch (e) { erro(res, e); }
});

// ===========================================================================
// BASES ANUAIS DA RECEITA — LUCRO REAL / PRESUMIDO
// ===========================================================================
router.get('/base-regime', async (_req, res) => {
  try { ok(res, await baseRegime.estatisticas()); } catch (e) { erro(res, e); }
});

/** Inspeciona o leiaute antes de importar — evita importar errado 1 milhão de linhas */
router.post('/base-regime/inspecionar', (req, res) => {
  try {
    if (!req.body.caminho) throw new Error('Informe o caminho do arquivo CSV no servidor.');
    ok(res, { leiaute: baseRegime.detectar(req.body.caminho) });
  } catch (e) { erro(res, e); }
});

/**
 * Importa por CAMINHO no servidor, não por upload: arquivo de 60 MB por HTTP
 * é frágil e desnecessário quando o sistema roda na mesma máquina.
 */
router.post('/base-regime/importar', async (req, res) => {
  try {
    const b = req.body;
    if (!b.caminho) throw new Error('Informe o caminho do arquivo CSV no servidor.');
    const r = await baseRegime.importar(b.caminho, b.regime, {
      ano: b.ano, substituir: !!b.substituir });
    ok(res, r);
  } catch (e) { erro(res, e); }
});

// No Render o usuário envia o CSV pelo navegador; nunca se usa um caminho do
// computador dele. O arquivo é temporário e a fonte definitiva é o Supabase.
router.post('/base-regime/upload', uploadBaseRegime.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Selecione um arquivo CSV.');
    const b = req.body;
    const nome = String(req.file.originalname || 'base-rfb.csv');
    const r = await baseRegime.importar(req.file.path, b.regime, { ano: b.ano, substituir: !!b.substituir });
    // O nome apresentado e gravado no histórico é o do arquivo do usuário,
    // não o nome aleatório criado na pasta temporária do Render.
    db.prepare('UPDATE base_regime SET fonte=? WHERE fonte=?').run(nome, r.arquivo);
    r.arquivo = nome;
    const compartilhada = await baseRegime.publicarImportacaoCompartilhada(nome, r, !!b.substituir);
    ok(res, { ...r, compartilhada });
  } catch (e) { erro(res, e); }
  finally { if (req.file?.path) fs.unlink(req.file.path, () => {}); }
});

router.get('/base-regime/consultar/:cnpj', (req, res) => {
  try { ok(res, { resultado: baseRegime.consultar(req.params.cnpj, req.query.ano) }); }
  catch (e) { erro(res, e); }
});

/** Refina Real x Presumido nos parceiros já identificados como regime regular */
router.post('/empresas/:id/parceiros/refinar-regime', async (req, res) => {
  try {
    const r = await baseRegime.refinarParceiros(req.params.id, { ano: req.body.ano });
    let classificacao = null;
    try {
      const tem = db.prepare('SELECT (SELECT COUNT(*) FROM base_ncm) + (SELECT COUNT(*) FROM base_servicos) c').get().c;
      if (tem) classificacao = bases.classificarMovimentos(req.params.id);
    } catch (_) { /* segue */ }
    ok(res, { ...r, classificacao });
  } catch (e) { erro(res, e); }
});

router.delete('/base-regime', (req, res) => {
  try { ok(res, { removidos: baseRegime.limpar(req.query.regime, req.query.ano) }); }
  catch (e) { erro(res, e); }
});

// ============ MÓDULO DE ACOMPANHAMENTO ============
// Acompanhamento só compara fotografias persistidas. Ele não chama o motor
// fiscal, não atualiza cenário e jamais substitui o baseline aprovado.
const acompanhamento = require('../services/acompanhamento');
const perfilOficialAcompanhamento = (empresaId) => db.prepare('SELECT * FROM perfil_cbs_competencias WHERE empresa_id=? ORDER BY competencia').all(empresaId);
const baselineAcompanhamento = (id) => db.prepare('SELECT * FROM monitoring_baselines WHERE id=?').get(id);
const snapshotAcompanhamento = (id) => db.prepare('SELECT * FROM monitoring_snapshots WHERE id=?').get(id);
function dadosAcompanhamento(empresaId) {
  const baselines = db.prepare('SELECT * FROM monitoring_baselines WHERE empresa_id=? ORDER BY versao DESC').all(empresaId);
  const snapshots = db.prepare('SELECT * FROM monitoring_snapshots WHERE empresa_id=? ORDER BY periodo DESC,id DESC').all(empresaId);
  const comparacoes = db.prepare(`SELECT c.*, b.versao baseline_versao, s.periodo snapshot_periodo FROM monitoring_comparisons c JOIN monitoring_baselines b ON b.id=c.baseline_id JOIN monitoring_snapshots s ON s.id=c.snapshot_id WHERE c.empresa_id=? ORDER BY c.id DESC`).all(empresaId);
  const desvios = comparacoes.length ? db.prepare(`SELECT d.* FROM monitoring_deviations d WHERE d.comparison_id IN (${comparacoes.map(() => '?').join(',')}) ORDER BY d.id DESC`).all(...comparacoes.map((x) => x.id)) : [];
  const alertas = db.prepare('SELECT * FROM monitoring_alerts WHERE empresa_id=? ORDER BY CASE prioridade WHEN \'ALTA\' THEN 1 WHEN \'MEDIA\' THEN 2 ELSE 3 END,id DESC').all(empresaId);
  const acoes = db.prepare('SELECT * FROM monitoring_actions WHERE empresa_id=? ORDER BY CASE status WHEN \'ABERTA\' THEN 1 WHEN \'EM_ANDAMENTO\' THEN 2 ELSE 3 END,prazo').all(empresaId);
  return { empresaId: Number(empresaId), baselines, snapshots, comparacoes, desvios, alertas, acoes };
}

router.get('/empresas/:id/acompanhamento', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    const { baselines, snapshots, comparacoes, desvios, alertas, acoes } = dadosAcompanhamento(req.params.id);
    const porPeriodo = snapshots.map((s) => ({ periodo: s.periodo, origem: s.origem, natureza: s.natureza, indicadores: acompanhamento.json(s.indicadores_realizados), comparacao: comparacoes.find((c) => Number(c.snapshot_id) === Number(s.id)) || null }));
    const aderencia = acompanhamento.aderencia(desvios, acoes);
    const executivo = acompanhamentoExecutivo.montar({ empresaId:Number(req.params.id), baselines, snapshots, comparacoes, desvios, alertas, acoes }, { aderencia });
    ok(res, { baselines: baselines.map((x) => ({ ...x, indicadores: acompanhamento.json(x.indicadores_aprovados), memoria: acompanhamento.json(x.memoria) })), snapshots: snapshots.map((x) => ({ ...x, indicadores: acompanhamento.json(x.indicadores_realizados), memoria: acompanhamento.json(x.memoria) })), comparacoes, desvios: desvios.map((x) => ({ ...x, memoria: acompanhamento.json(x.memoria) })), alertas, acoes, evolucao: porPeriodo, aderencia, executivo });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/acompanhamento/baselines', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    const b = req.body || {}, empresaId = Number(req.params.id);
    const anterior = db.prepare('SELECT MAX(versao) versao FROM monitoring_baselines WHERE empresa_id=?').get(empresaId);
    const indicadores = b.indicadores || acompanhamento.indicadoresPerfil(perfilOficialAcompanhamento(empresaId));
    const versao = Number(anterior?.versao || 0) + 1;
    const memoria = { tipo: 'BASELINE_APROVADO', fonte: b.origem || 'PERFIL_CBS_OFICIAL', indicadores, observacao: 'Fotografia congelada; alterações futuras geram nova versão.' };
    const r = db.prepare(`INSERT INTO monitoring_baselines (empresa_id,versao,data_aprovacao,origem,descricao,cenario_referencia,premissas_aprovadas,indicadores_aprovados,composicao_fornecedores,composicao_clientes,classificacoes_esperadas,recomendacoes_aprovadas,natureza,memoria) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(empresaId, versao, b.data_aprovacao || new Date().toISOString(), b.origem || 'PERFIL_CBS_OFICIAL', b.descricao || '', b.cenario_referencia || '', acompanhamento.stringify(b.premissas_aprovadas), acompanhamento.stringify(indicadores), acompanhamento.stringify(b.composicao_fornecedores), acompanhamento.stringify(b.composicao_clientes), acompanhamento.stringify(b.classificacoes_esperadas), acompanhamento.stringify(b.recomendacoes_aprovadas), b.natureza || 'CALCULADO', acompanhamento.stringify(memoria));
    auditar(req, { empresaId, acao: 'Criou baseline de acompanhamento', entidade: 'monitoring_baseline', entidadeId: r.lastInsertRowid, depois: { versao, origem: b.origem || 'PERFIL_CBS_OFICIAL' } });
    ok(res, { baseline: baselineAcompanhamento(r.lastInsertRowid) });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/acompanhamento/snapshots', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    const b = req.body || {}, empresaId = Number(req.params.id);
    if (!b.periodo) throw new Error('Informe o período da fotografia realizada.');
    const indicadores = b.indicadores || acompanhamento.indicadoresPerfil(perfilOficialAcompanhamento(empresaId).filter((x) => !b.periodo || x.competencia === b.periodo));
    const memoria = { tipo: 'FOTOGRAFIA_REALIZADA', fonte: b.origem || 'PLATAFORMA', periodo: b.periodo, indicadores };
    const r = db.prepare(`INSERT INTO monitoring_snapshots (empresa_id,periodo,origem,natureza,indicadores_realizados,composicao_fornecedores,composicao_clientes,classificacoes_reais,cobertura_dados,memoria) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(empresaId, b.periodo, b.origem || 'PLATAFORMA', b.natureza || 'CALCULADO', acompanhamento.stringify(indicadores), acompanhamento.stringify(b.composicao_fornecedores), acompanhamento.stringify(b.composicao_clientes), acompanhamento.stringify(b.classificacoes_reais), acompanhamento.stringify(b.cobertura_dados), acompanhamento.stringify(memoria));
    auditar(req, { empresaId, acao: 'Registrou fotografia realizada', entidade: 'monitoring_snapshot', entidadeId: r.lastInsertRowid, depois: { periodo: b.periodo, origem: b.origem || 'PLATAFORMA' } });
    ok(res, { snapshot: snapshotAcompanhamento(r.lastInsertRowid) });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/acompanhamento/comparacoes', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    const baseline = baselineAcompanhamento(req.body.baseline_id), snapshot = snapshotAcompanhamento(req.body.snapshot_id);
    if (!baseline || baseline.empresa_id !== Number(req.params.id)) throw new Error('Baseline não encontrado para esta empresa.');
    if (!snapshot || snapshot.empresa_id !== Number(req.params.id)) throw new Error('Fotografia realizada não encontrada para esta empresa.');
    const resultado = acompanhamento.comparar(baseline, snapshot);
    const memoria = { baseline_id: baseline.id, snapshot_id: snapshot.id, resultado: resultado.status, regra: 'PREVISTO_X_REALIZADO' };
    const r = db.prepare('INSERT OR REPLACE INTO monitoring_comparisons (empresa_id,baseline_id,snapshot_id,status,memoria) VALUES (?,?,?,?,?)').run(Number(req.params.id), baseline.id, snapshot.id, resultado.status, acompanhamento.stringify(memoria));
    const comparacao = db.prepare('SELECT id FROM monitoring_comparisons WHERE baseline_id=? AND snapshot_id=?').get(baseline.id, snapshot.id);
    db.prepare('DELETE FROM monitoring_deviations WHERE comparison_id=?').run(comparacao.id);
    const inserir = db.prepare(`INSERT INTO monitoring_deviations (comparison_id,metrica,tipo,baseline_valor,realizado_valor,diferenca_absoluta,diferenca_percentual,status,causa,evidencia,acao_sugerida,natureza,memoria) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    db.transaction(() => resultado.desvios.forEach((d) => inserir.run(comparacao.id,d.metrica,d.tipo,d.baseline_valor,d.realizado_valor,d.diferenca_absoluta,d.diferenca_percentual,d.status,d.causa,d.evidencia,d.acao_sugerida,d.natureza,acompanhamento.stringify(acompanhamento.memoria(baseline,snapshot,d)))))();
    ok(res, { comparison_id: comparacao.id, status: resultado.status, desvios: resultado.desvios });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/acompanhamento/alertas/gerar', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    const desvios = db.prepare(`SELECT d.* FROM monitoring_deviations d JOIN monitoring_comparisons c ON c.id=d.comparison_id WHERE c.empresa_id=?`).all(req.params.id);
    const inserir = db.prepare(`INSERT INTO monitoring_alerts (empresa_id,desvio_id,titulo,mensagem,prioridade,impacto,evidencia,natureza,status) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(desvio_id) DO UPDATE SET titulo=excluded.titulo,mensagem=excluded.mensagem,prioridade=excluded.prioridade,impacto=excluded.impacto,evidencia=excluded.evidencia,natureza=excluded.natureza`);
    let gerados = 0;
    db.transaction(() => desvios.forEach((d) => { const a = acompanhamento.alerta(d); if (!a) return; inserir.run(Number(req.params.id),d.id,a.titulo,a.mensagem,a.prioridade,a.impacto,a.evidencia,a.natureza,'ABERTO'); gerados++; }))();
    ok(res, { gerados });
  } catch (e) { erro(res, e); }
});

router.post('/empresas/:id/acompanhamento/acoes', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    const b = req.body || {}, d = db.prepare(`SELECT d.* FROM monitoring_deviations d JOIN monitoring_comparisons c ON c.id=d.comparison_id WHERE d.id=? AND c.empresa_id=?`).get(b.desvio_id, req.params.id);
    if (!d) throw new Error('Desvio verificável não encontrado para esta empresa.');
    if (!d.evidencia) throw new Error('Uma ação corretiva exige evidência do desvio de origem.');
    if (!b.acao) throw new Error('Descreva a ação corretiva.');
    const r = db.prepare(`INSERT INTO monitoring_actions (empresa_id,desvio_id,acao,responsavel,prazo,prioridade,status,evidencia,origem) VALUES (?,?,?,?,?,?,?,?,?)`).run(req.params.id,d.id,b.acao,b.responsavel || '',b.prazo || null,b.prioridade || acompanhamento.alerta(d)?.prioridade || 'MEDIA','ABERTA',d.evidencia,b.origem || 'ACOMPANHAMENTO');
    auditar(req, { empresaId: req.params.id, acao: 'Criou ação corretiva de acompanhamento', entidade: 'monitoring_action', entidadeId: r.lastInsertRowid, depois: { desvio_id: d.id, prioridade: b.prioridade || 'MEDIA' } });
    ok(res, { acao: db.prepare('SELECT * FROM monitoring_actions WHERE id=?').get(r.lastInsertRowid) });
  } catch (e) { erro(res, e); }
});

router.put('/acompanhamento/acoes/:id', async (req, res) => {
  try {
    const atual = db.prepare('SELECT * FROM monitoring_actions WHERE id=?').get(req.params.id); if (!atual) throw new Error('Ação não encontrada.');
    await garantirEmpresaPermitida(req, atual.empresa_id);
    const b = req.body || {}, status = b.status || atual.status;
    if (!['ABERTA','EM_ANDAMENTO','CONCLUIDA','CANCELADA'].includes(status)) throw new Error('Status de ação inválido.');
    db.prepare('UPDATE monitoring_actions SET acao=?,responsavel=?,prazo=?,prioridade=?,status=?,evidencia=?,atualizado_em=? WHERE id=?').run(b.acao ?? atual.acao,b.responsavel ?? atual.responsavel,b.prazo ?? atual.prazo,b.prioridade ?? atual.prioridade,status,b.evidencia ?? atual.evidencia,new Date().toISOString(),atual.id);
    ok(res, { acao: db.prepare('SELECT * FROM monitoring_actions WHERE id=?').get(atual.id) });
  } catch (e) { erro(res, e); }
});

router.get('/empresas/:id/acompanhamento/saida-executiva', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    const dados = dadosAcompanhamento(req.params.id);
    ok(res, { relatorio: acompanhamentoExecutivo.montar(dados, { baseline_id:req.query.baseline_id, snapshot_id:req.query.snapshot_id, aderencia:acompanhamento.aderencia(dados.desvios, dados.acoes) }) });
  } catch (e) { erro(res, e); }
});
router.get('/empresas/:id/acompanhamento/saida-executiva.pdf', async (req, res) => {
  try {
    await garantirEmpresaPermitida(req, req.params.id);
    const dados = dadosAcompanhamento(req.params.id);
    const relatorio = acompanhamentoExecutivo.montar(dados, { baseline_id:req.query.baseline_id, snapshot_id:req.query.snapshot_id, aderencia:acompanhamento.aderencia(dados.desvios, dados.acoes) });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="acompanhamento-${req.query.consolidado === '1' ? 'consolidado' : 'periodo'}.pdf"`);
    acompanhamentoExecutivo.gerarPdf(relatorio, res, { consolidado:req.query.consolidado === '1' });
  } catch (e) { erro(res, e); }
});
router.get('/acompanhamento/desvios/:id/memoria', async (req, res) => {
  try {
    const d = db.prepare('SELECT d.*,c.empresa_id,c.baseline_id,c.snapshot_id FROM monitoring_deviations d JOIN monitoring_comparisons c ON c.id=d.comparison_id WHERE d.id=?').get(req.params.id);
    if (!d) throw new Error('Desvio não encontrado.'); await garantirEmpresaPermitida(req, d.empresa_id);
    const baseline = baselineAcompanhamento(d.baseline_id), snapshot = snapshotAcompanhamento(d.snapshot_id);
    const acoes = db.prepare('SELECT * FROM monitoring_actions WHERE desvio_id=? ORDER BY id').all(d.id);
    const alertas = db.prepare('SELECT * FROM monitoring_alerts WHERE desvio_id=? ORDER BY id').all(d.id);
    ok(res, { desvio: d, baseline, snapshot, acoes, alertas, memoria: acompanhamento.json(d.memoria) });
  } catch (e) { erro(res, e); }
});

module.exports = router;

/** Resolvedor declarativo de enquadramento. Não executa fórmula econômica. */
const db = require('../db');
const { resolver: resolverPerfil } = require('./resolvedorPerfil');
const supabase = require('./supabase');
const txt = (v) => String(v || '').trim();

function dentroVigencia(regra, data) {
  const d = String(data || '2027-01-01').slice(0, 10);
  return (!regra.vigencia_inicio || regra.vigencia_inicio <= d) && (!regra.vigencia_fim || regra.vigencia_fim >= d);
}
function casa(regra, c) {
  const campos = ['tipo_operacao','direcao','perfil_fornecedor','perfil_adquirente','regime_fornecedor','regime_adquirente','regime_pis_cofins','ncm','nbs','cclasstrib','cst','cfop','papel_cadeia','unidade'];
  for (const campo of campos) if (txt(regra[campo]) && txt(regra[campo]) !== txt(c[campo])) return false;
  return dentroVigencia(regra, c.data);
}
function faltas(regra, c) {
  let condicoes = [];
  try { condicoes = JSON.parse(regra.condicoes_obrigatorias || '[]'); } catch (_) { return ['condicoes_obrigatorias inválidas']; }
  return condicoes.filter((campo) => !c[campo]).map((campo) => String(campo));
}
function excluida(regra, c) {
  let condicoes = [];
  try { condicoes = JSON.parse(regra.condicoes_excludentes || '[]'); } catch (_) { return false; }
  return condicoes.some((campo) => Boolean(c[campo]));
}
function resolverComRegras(contexto = {}, regrasDisponiveis = []) {
  const fornecedor = resolverPerfil({ ...contexto, cnpj: contexto.cnpj_fornecedor, parceiro: contexto.fornecedor });
  const adquirente = resolverPerfil({ ...contexto, cnpj: contexto.cnpj_adquirente, parceiro: contexto.adquirente });
  const regimePis = txt(contexto.regime_pis_cofins) || ({ lucro_presumido:'CUMULATIVO', lucro_real:'NAO_CUMULATIVO' }[txt(contexto.regime)] || '');
  const c = {
    tipo_operacao: contexto.tipo_operacao || '', direcao: contexto.direcao || '', ncm: txt(contexto.ncm), nbs: txt(contexto.nbs),
    cclasstrib: txt(contexto.cclasstrib), cst: txt(contexto.cst), cfop: txt(contexto.cfop), papel_cadeia: txt(contexto.papel_cadeia), unidade: txt(contexto.unidade), data: contexto.data,
    perfil_fornecedor: fornecedor.perfil, perfil_adquirente: adquirente.perfil, regime_fornecedor: fornecedor.regime_cbs, regime_adquirente: adquirente.regime_cbs, regime_pis_cofins: regimePis,
  };
  // Documento conclusivo prevalece; esta camada apenas torna a precedência visível.
  if (contexto.documento_conclusivo && (c.cclasstrib || c.cst)) return { status: 'DETERMINADO', origem: 'DOCUMENTO', contexto: c, regra: null, tratamento: contexto.tratamento_documento || null, pendencias: [] };
  const regras = regrasDisponiveis;
  const candidatas = regras.filter((r) => casa(r, c) && !excluida(r, contexto));
  const completas = candidatas.filter((r) => !faltas(r, contexto).length);
  // Duas regras completas com a mesma prioridade e versão não podem ser
  // escolhidas pela ordem do banco: exigem decisão explícita e rastreável.
  if (completas.length > 1 && completas[0].prioridade === completas[1].prioridade && completas[0].versao === completas[1].versao) {
    return { status: 'SUJEITO_VALIDACAO', codigo: 'CONFLITO_DE_REGRAS', origem: 'CONFLITO_DE_REGRAS', contexto: c,
      regra: null, tratamento: null, pendencias: ['Duas regras ativas possuem a mesma prioridade e versão para os mesmos fatos.'], regras_conflitantes: completas.slice(0, 2).map((x) => x.id) };
  }
  for (const regra of completas) {
    return { status: 'DETERMINADO', origem: 'REGRA_ENQUADRAMENTO', contexto: c, regra, tratamento: regra.tratamento_resultante, pendencias: [] };
  }
  const condicional = candidatas[0];
  return { status: condicional ? 'SUJEITO_VALIDACAO' : 'INDETERMINADO', origem: condicional ? 'REGRA_CONDICIONAL' : 'SEM_REGRA', contexto: c,
    regra: condicional || null, tratamento: null, pendencias: condicional ? faltas(condicional, contexto) : ['Regra de enquadramento ou evidência documental não encontrada.'] };
}

function resolver(contexto = {}) {
  const regras = db.prepare("SELECT * FROM regras_enquadramento WHERE status='ATIVA' ORDER BY prioridade DESC, versao DESC, id").all();
  return resolverComRegras(contexto, regras);
}
async function resolverCompartilhado(contexto = {}) {
  if (!supabase.configurado()) throw new Error('Supabase não configurado no .env.');
  const { data, error } = await supabase.admin().from('regras_enquadramento').select('*').eq('status', 'ATIVA')
    .order('prioridade', { ascending: false }).order('versao', { ascending: false }).order('id');
  if (error) throw new Error(`regras_enquadramento: ${error.message}`);
  return resolverComRegras(contexto, data || []);
}

module.exports = { resolver, resolverCompartilhado, resolverComRegras, casa, dentroVigencia, faltas, excluida };

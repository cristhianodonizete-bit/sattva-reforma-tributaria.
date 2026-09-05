const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = require('./supabase');

// Cache de autorização estritamente efêmero. O token nunca é mantido em
// memória como chave; somente seu hash. O TTL também nunca ultrapassa o exp
// do JWT, evitando aceitar uma sessão expirada por causa do cache.
const CACHE_AUTENTICACAO_MS = 15_000;
const sessoes = new Map();
const usuarios = new Map();
const chaveToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const expiraTokenEm = (token) => {
  try {
    const payload = String(token).split('.')[1];
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(dados.exp) > 0 ? Number(dados.exp) * 1000 : null;
  } catch (_) { return null; }
};
const vencimentoSeguro = (token) => {
  const agora = Date.now();
  const exp = expiraTokenEm(token);
  return Math.min(agora + CACHE_AUTENTICACAO_MS, exp || (agora + CACHE_AUTENTICACAO_MS));
};
const vigente = (entrada) => entrada && entrada.vence_em > Date.now();
function limparExpirados() {
  for (const [chave, valor] of sessoes) if (!vigente(valor)) sessoes.delete(chave);
  for (const [chave, valor] of usuarios) if (!vigente(valor)) usuarios.delete(chave);
}

function exigida() { return supabase.configurado() && process.env.AUTH_REQUIRED !== 'false'; }
function clientePublico() {
  if (!process.env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY não configurada.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}
async function montarUsuario(user) {
  limparExpirados();
  const emCache = usuarios.get(user.id);
  if (vigente(emCache)) return emCache.usuario;
  const { data: perfil, error: erroPerfil } = await supabase.admin().from('perfis').select('nome,papel,ativo,perfil_acesso_id').eq('id', user.id).maybeSingle();
  if (erroPerfil) throw erroPerfil;
  if (perfil && !perfil.ativo) throw new Error('Usuário desativado.');
  let perfilAcesso = null;
  if (perfil?.perfil_acesso_id) {
    const { data, error } = await supabase.admin().from('perfis_acesso').select('nome,permissoes,ativo').eq('id', perfil.perfil_acesso_id).maybeSingle();
    if (error) throw error;
    if (data && !data.ativo) throw new Error('O perfil de acesso deste usuário está desativado.');
    perfilAcesso = data;
  }
  const usuario = { id: user.id, email: user.email, ...(perfil || { papel: 'consultor' }), perfil_acesso: perfilAcesso?.nome || null, permissoes: perfilAcesso?.permissoes || null };
  usuarios.set(user.id, { vence_em: Date.now() + CACHE_AUTENTICACAO_MS, usuario, perfil_acesso_id: perfil?.perfil_acesso_id || null });
  return usuario;
}
async function validar(req, res, next) {
  if (!exigida()) return next();
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Faça login para acessar o sistema.');
    limparExpirados();
    const chave = chaveToken(token);
    const sessaoEmCache = sessoes.get(chave);
    if (vigente(sessaoEmCache)) {
      req.usuario = sessaoEmCache.usuario;
      return next();
    }
    const { data, error } = await clientePublico().auth.getUser(token);
    if (error || !data.user) throw new Error('Sua sessão expirou. Entre novamente.');
    const usuario = await montarUsuario(data.user);
    const venceEm = vencimentoSeguro(token);
    if (venceEm > Date.now()) sessoes.set(chave, { vence_em: venceEm, usuario });
    req.usuario = usuario;
    next();
  } catch (e) { res.status(401).json({ ok: false, erro: e.message || 'Não autorizado.' }); }
}
function invalidarUsuario(usuarioId) {
  usuarios.delete(String(usuarioId));
  for (const [chave, sessao] of sessoes) if (String(sessao.usuario?.id) === String(usuarioId)) sessoes.delete(chave);
}
function invalidarPerfilAcesso(perfilAcessoId) {
  const ids = [...usuarios.entries()].filter(([, valor]) => String(valor.perfil_acesso_id || '') === String(perfilAcessoId || '')).map(([id]) => id);
  ids.forEach(invalidarUsuario);
}
function limparCache() { sessoes.clear(); usuarios.clear(); }
module.exports = { exigida, validar, montarUsuario, invalidarUsuario, invalidarPerfilAcesso, limparCache, CACHE_AUTENTICACAO_MS };

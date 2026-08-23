const { createClient } = require('@supabase/supabase-js');
const supabase = require('./supabase');

function exigida() { return supabase.configurado() && process.env.AUTH_REQUIRED !== 'false'; }
function clientePublico() {
  if (!process.env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY não configurada.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}
async function montarUsuario(user) {
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
  return { id: user.id, email: user.email, ...(perfil || { papel: 'consultor' }), perfil_acesso: perfilAcesso?.nome || null, permissoes: perfilAcesso?.permissoes || null };
}
async function validar(req, res, next) {
  if (!exigida()) return next();
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Faça login para acessar o sistema.');
    const { data, error } = await clientePublico().auth.getUser(token);
    if (error || !data.user) throw new Error('Sua sessão expirou. Entre novamente.');
    req.usuario = await montarUsuario(data.user);
    next();
  } catch (e) { res.status(401).json({ ok: false, erro: e.message || 'Não autorizado.' }); }
}
module.exports = { exigida, validar, montarUsuario };

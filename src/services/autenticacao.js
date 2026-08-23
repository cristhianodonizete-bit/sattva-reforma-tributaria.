const { createClient } = require('@supabase/supabase-js');
const supabase = require('./supabase');

function exigida() { return supabase.configurado() && process.env.AUTH_REQUIRED !== 'false'; }
function clientePublico() {
  if (!process.env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY não configurada.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}
async function validar(req, res, next) {
  if (!exigida()) return next();
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Faça login para acessar o sistema.');
    const { data, error } = await clientePublico().auth.getUser(token);
    if (error || !data.user) throw new Error('Sua sessão expirou. Entre novamente.');
    const { data: perfil, error: erroPerfil } = await supabase.admin().from('perfis').select('nome,papel,ativo').eq('id', data.user.id).maybeSingle();
    if (erroPerfil) throw erroPerfil;
    if (perfil && !perfil.ativo) throw new Error('Este usuário está desativado.');
    req.usuario = { id: data.user.id, email: data.user.email, ...(perfil || { papel: 'consultor' }) };
    next();
  } catch (e) { res.status(401).json({ ok: false, erro: e.message || 'Não autorizado.' }); }
}
module.exports = { exigida, validar };

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const supabase = require('../services/supabase');
const autenticacao = require('../services/autenticacao');
const router = express.Router();

function publico() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new Error('Autenticação Supabase não configurada.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

router.get('/status', (_req, res) => {
  let cache = null;
  try {
    const db = require('../db');
    cache = {
      empresas: db.prepare('SELECT COUNT(*) c FROM empresas').get().c,
      parceiros: db.prepare('SELECT COUNT(*) c FROM parceiros').get().c,
      movimentos: db.prepare('SELECT COUNT(*) c FROM movimentos').get().c,
    };
  } catch (_) { /* diagnóstico não impede a autenticação */ }
  // Diagnóstico de implantação: permite confirmar que a instância pública
  // executa o commit esperado sem expor configuração, dados fiscais ou sessão.
  res.json({ ok: true, configurado: supabase.configurado(), exigido: autenticacao.exigida(),
    commit_render: process.env.RENDER_GIT_COMMIT || null, cache });
});

router.post('/login', async (req, res) => {
  try {
    const { data, error } = await publico().auth.signInWithPassword({ email: String(req.body.email || '').trim(), password: String(req.body.senha || '') });
    if (error) throw error;
    const usuario = await autenticacao.montarUsuario(data.user);
    res.json({ ok: true, sessao: { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expira_em: data.session.expires_at }, usuario });
  } catch (e) { res.status(401).json({ ok: false, erro: e.message || 'Não foi possível entrar.' }); }
});

router.post('/esqueci-senha', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim();
    if (!email) throw new Error('Informe seu e-mail.');
    const { error } = await publico().auth.resetPasswordForEmail(email, { redirectTo: process.env.APP_URL || 'https://sattva-reforma-tributaria.onrender.com' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, erro: e.message || 'Não foi possível enviar o e-mail.' }); }
});

router.get('/me', async (req, res) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Sessão não informada.');
    const { data, error } = await publico().auth.getUser(token);
    if (error) throw error;
    res.json({ ok: true, usuario: await autenticacao.montarUsuario(data.user) });
  } catch (e) { res.status(401).json({ ok: false, erro: e.message || 'Sessão inválida.' }); }
});

router.post('/redefinir-senha', async (req, res) => {
  try {
    const token = String(req.body.token || '');
    const senha = String(req.body.senha || '');
    if (senha.length < 8) throw new Error('A senha deve ter ao menos 8 caracteres.');
    const { data, error } = await publico().auth.getUser(token);
    if (error || !data.user) throw new Error('O link de recuperação expirou. Solicite um novo.');
    const { error: atualizacao } = await supabase.admin().auth.admin.updateUserById(data.user.id, { password: senha });
    if (atualizacao) throw atualizacao;
    const nome = String(req.body.nome || '').trim();
    if (nome) { const { error: perfil } = await supabase.admin().from('perfis').upsert({ id: data.user.id, nome, atualizado_em: new Date().toISOString() }); if (perfil) throw perfil; }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, erro: e.message || 'Não foi possível redefinir a senha.' }); }
});

module.exports = router;

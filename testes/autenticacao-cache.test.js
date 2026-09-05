const assert = require('node:assert/strict');
const path = require('node:path');

process.env.AUTH_REQUIRED = 'true';
process.env.SUPABASE_URL = 'https://teste.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';

let chamadasToken = 0, chamadasPerfil = 0, chamadasAcesso = 0;
const mockAdmin = () => ({
  from: (tabela) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (tabela === 'perfis') {
            chamadasPerfil++;
            return { data: { nome: 'Teste', papel: 'consultor', ativo: true, perfil_acesso_id: 'perfil-1' }, error: null };
          }
          chamadasAcesso++;
          return { data: { nome: 'Operação', ativo: true, permissoes: { visao_geral: { ver: true } } }, error: null };
        },
      }),
    }),
  }),
});

require.cache[require.resolve('../src/services/supabase')] = { exports: { configurado: () => true, admin: mockAdmin } };
require.cache[require.resolve('@supabase/supabase-js')] = { exports: { createClient: () => ({ auth: { getUser: async () => { chamadasToken++; return { data: { user: { id: 'usuario-1', email: 'teste@sattva.com' } }, error: null }; } } }) } };
const autenticacao = require('../src/services/autenticacao');
const token = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.x`;
const validar = () => new Promise((resolve, reject) => autenticacao.validar({ headers: { authorization: `Bearer ${token}` } }, { status: () => ({ json: reject }) }, resolve));

(async () => {
  autenticacao.limparCache();
  await validar(); await validar();
  assert.equal(chamadasToken, 1, 'o mesmo token válido deve ser validado remotamente uma vez dentro do TTL');
  assert.equal(chamadasPerfil, 1); assert.equal(chamadasAcesso, 1);
  autenticacao.invalidarUsuario('usuario-1');
  await validar();
  assert.equal(chamadasToken, 2, 'a invalidação de usuário deve forçar nova validação remota');
  console.log('autenticacao-cache: token hash, TTL, perfil e invalidação imediata: OK');
})().catch((e) => { console.error(e); process.exitCode = 1; });

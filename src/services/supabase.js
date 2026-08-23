const { createClient } = require('@supabase/supabase-js');

function configurado() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function admin() {
  if (!configurado()) throw new Error('Supabase não configurado no .env.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = { configurado, admin };

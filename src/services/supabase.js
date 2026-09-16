const { createClient } = require('@supabase/supabase-js');

function configurado() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Uma indisponibilidade remota não pode deixar uma inicialização esperando
// para sempre. O prazo vale por requisição/página; cargas grandes continuam
// possíveis, mas uma página parada passa a falhar de modo rastreável.
function fetchComPrazo(input, init = {}, prazoMs = 30_000) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), prazoMs);
  if (init.signal) init.signal.addEventListener('abort', () => controle.abort(), { once: true });
  return fetch(input, { ...init, signal: controle.signal }).finally(() => clearTimeout(relogio));
}

function admin() {
  if (!configurado()) throw new Error('Supabase não configurado no .env.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchComPrazo },
  });
}

module.exports = { configurado, admin, fetchComPrazo };

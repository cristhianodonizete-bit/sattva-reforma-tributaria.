const { createClient } = require('@supabase/supabase-js');

function configurado() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Uma indisponibilidade remota não pode deixar o proxy HTTP encerrar a
// requisição antes de a API devolver um JSON tratado. Doze segundos deixa
// margem para a resposta normal do Supabase e evita o 502 genérico em telas
// de confirmação. Pode ser ampliado explicitamente em ambiente que execute
// cargas muito grandes, sem mudar o prazo das interações do usuário.
function fetchComPrazo(input, init = {}, prazoMs = Number(process.env.SUPABASE_TIMEOUT_MS || 12_000)) {
  const controle = new AbortController();
  let expirou = false;
  const relogio = setTimeout(() => { expirou = true; controle.abort(); }, prazoMs);
  if (init.signal) init.signal.addEventListener('abort', () => controle.abort(), { once: true });
  return fetch(input, { ...init, signal: controle.signal })
    .catch((causa) => {
      if (expirou) {
        const erro = new Error(`Fonte compartilhada não respondeu em ${Math.round(prazoMs / 1000)} segundos.`);
        erro.code = 'SUPABASE_TIMEOUT';
        throw erro;
      }
      throw causa;
    })
    .finally(() => clearTimeout(relogio));
}

function admin() {
  if (!configurado()) throw new Error('Supabase não configurado no .env.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchComPrazo },
  });
}

module.exports = { configurado, admin, fetchComPrazo };

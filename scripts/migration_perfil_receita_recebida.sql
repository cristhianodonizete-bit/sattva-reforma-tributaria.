-- A receita recebida é informada pelo PGDAS em empresas apuradas pelo
-- regime de caixa. A coluna precisa existir também na fonte compartilhada,
-- que é usada para preservar confirmações entre reinicializações.
ALTER TABLE public.perfil_tributario
  ADD COLUMN IF NOT EXISTS receita_recebida numeric;

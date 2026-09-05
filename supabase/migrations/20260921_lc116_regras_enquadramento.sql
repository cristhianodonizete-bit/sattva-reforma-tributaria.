-- Preserva a identidade composta de regras de serviço: LC116 + NBS.
ALTER TABLE public.regras_enquadramento ADD COLUMN IF NOT EXISTS lc116 text;
CREATE INDEX IF NOT EXISTS ix_regras_enquadramento_lc116_nbs
  ON public.regras_enquadramento(status, lc116, nbs, prioridade DESC);

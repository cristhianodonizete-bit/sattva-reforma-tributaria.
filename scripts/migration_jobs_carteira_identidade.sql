-- processamento_id é um número local, reiniciado quando a instância é
-- recriada. Ele não pode identificar um job no armazenamento compartilhado.
-- O UUID da coluna id já é a identidade durável e exclusiva do job.
ALTER TABLE public.jobs_carteira
  DROP CONSTRAINT IF EXISTS jobs_carteira_processamento_id_empresa_id_competencia_tipo__key;

CREATE INDEX IF NOT EXISTS ix_jobs_carteira_empresa_status
  ON public.jobs_carteira (empresa_id, status, criado_em DESC);

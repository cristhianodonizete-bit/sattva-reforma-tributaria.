-- Configuração global dos provedores de IA. RLS sem policies impede acesso
-- direto de clientes; somente o backend com service role sincroniza os dados.
CREATE TABLE IF NOT EXISTS public.ia_config_compartilhada (
  id smallint PRIMARY KEY CHECK (id = 1),
  api_key text NOT NULL DEFAULT '',
  modelo text NOT NULL DEFAULT 'claude-sonnet-5',
  especialista_fiscal_ativo boolean NOT NULL DEFAULT false,
  especialista_painel_ativo boolean NOT NULL DEFAULT false,
  provedores_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ia_config_compartilhada ENABLE ROW LEVEL SECURITY;

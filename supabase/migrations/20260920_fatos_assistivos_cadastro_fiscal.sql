-- Estrutura futura, não aplicada: fatos objetivos dos rascunhos assistivos.
-- Não ativa regra, não altera resultados e não modifica dados existentes.
ALTER TABLE public.empresa_produto_fiscal
  ADD COLUMN IF NOT EXISTS possui_sintetizador_voz boolean,
  ADD COLUMN IF NOT EXISTS adaptado_para_pessoa_com_deficiencia boolean,
  ADD COLUMN IF NOT EXISTS acionador_pressao boolean;

COMMENT ON COLUMN public.empresa_produto_fiscal.possui_sintetizador_voz IS
  'Fato objetivo do produto para rascunhos do art. 28, XXV e XXIX, Lei 10.865/2004.';
COMMENT ON COLUMN public.empresa_produto_fiscal.adaptado_para_pessoa_com_deficiencia IS
  'Fato objetivo do produto para rascunho do art. 28, XXVII, Lei 10.865/2004.';
COMMENT ON COLUMN public.empresa_produto_fiscal.acionador_pressao IS
  'Fato objetivo do produto para rascunho do art. 28, XXXI, Lei 10.865/2004.';

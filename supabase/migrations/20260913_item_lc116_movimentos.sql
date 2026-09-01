-- Campo próprio para o item da Lista de Serviços (LC 116) extraído do XML.
-- O campo legado cst é preservado para rastreabilidade e compatibilidade.
ALTER TABLE IF EXISTS public.movimentos ADD COLUMN IF NOT EXISTS lc116 text;

UPDATE public.movimentos
SET lc116 = substring(cst from 1 for 4)
WHERE origem = 'xml'
  AND COALESCE(lc116, '') = ''
  AND COALESCE(ncm, '') = ''
  AND COALESCE(iss, 0) <> 0
  AND length(COALESCE(cst, '')) >= 4;

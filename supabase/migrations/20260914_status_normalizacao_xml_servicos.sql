-- Estado operacional da normalização documental. Não cria cálculo e não
-- altera valores fiscais: apenas torna explícita a evidência presente e a
-- pendência que cabe ao usuário revisar.
ALTER TABLE IF EXISTS public.movimentos
  ADD COLUMN IF NOT EXISTS normalizacao_status text,
  ADD COLUMN IF NOT EXISTS normalizacao_pendencia text,
  ADD COLUMN IF NOT EXISTS normalizacao_evidencia text;

UPDATE public.movimentos
SET normalizacao_status = CASE
      WHEN COALESCE(lc116, '') = '' THEN 'PENDENTE'
      WHEN COALESCE(nbs, '') = '' THEN 'PENDENTE'
      ELSE 'VALIDADO'
    END,
    normalizacao_pendencia = CASE
      WHEN COALESCE(lc116, '') = '' THEN 'LC116_NAO_IDENTIFICADO'
      WHEN COALESCE(nbs, '') = '' THEN 'LC116_IDENTIFICADO_SEM_NBS'
      ELSE ''
    END,
    normalizacao_evidencia = CASE
      WHEN COALESCE(lc116, '') <> '' THEN 'Item LC116: ' || lc116 || CASE WHEN COALESCE(cst, '') <> '' THEN ' · Código fiscal bruto do XML: ' || cst ELSE '' END
      WHEN COALESCE(cst, '') <> '' THEN 'Código fiscal bruto do XML: ' || cst
      ELSE 'XML de serviço sem item LC116 identificado.'
    END
WHERE origem = 'xml'
  AND COALESCE(ncm, '') = ''
  AND COALESCE(iss, 0) <> 0;

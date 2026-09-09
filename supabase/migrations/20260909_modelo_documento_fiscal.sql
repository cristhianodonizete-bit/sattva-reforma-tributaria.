-- Modelo fiscal é evidência do documento, não inferência de classificação.
ALTER TABLE IF EXISTS public.movimentos
  ADD COLUMN IF NOT EXISTS modelo_documento_fiscal text;

-- Recuperação conservadora: a chave de 44 dígitos traz o modelo nas posições
-- 21-22. CST nunca é usado para deduzir que um XML seja NFS-e.
UPDATE public.movimentos
SET modelo_documento_fiscal = CASE
  WHEN length(regexp_replace(COALESCE(chave,''), '\\D', '', 'g')) = 44
    AND substr(regexp_replace(COALESCE(chave,''), '\\D', '', 'g'), 21, 2) = '55' THEN 'nfe'
  WHEN length(regexp_replace(COALESCE(chave,''), '\\D', '', 'g')) = 44
    AND substr(regexp_replace(COALESCE(chave,''), '\\D', '', 'g'), 21, 2) = '65' THEN 'nfce'
  WHEN length(regexp_replace(COALESCE(chave,''), '\\D', '', 'g')) = 44
    AND substr(regexp_replace(COALESCE(chave,''), '\\D', '', 'g'), 21, 2) = '57' THEN 'cte'
  WHEN length(regexp_replace(COALESCE(chave,''), '\\D', '', 'g')) = 44
    AND substr(regexp_replace(COALESCE(chave,''), '\\D', '', 'g'), 21, 2) = '62' THEN 'nfcom'
  WHEN COALESCE(ncm,'') <> '' THEN 'nfe'
  WHEN COALESCE(nbs,'') <> '' OR COALESCE(lc116,'') <> '' OR COALESCE(iss,0) <> 0 THEN 'nfse'
  ELSE NULL
END
WHERE COALESCE(modelo_documento_fiscal,'') = '' AND COALESCE(origem,'') = 'xml';

UPDATE public.movimentos
SET lc116 = NULL, normalizacao_status = 'NAO_APLICAVEL', normalizacao_pendencia = '', normalizacao_evidencia = ''
WHERE COALESCE(origem,'') = 'xml'
  AND lower(COALESCE(modelo_documento_fiscal,'')) IN ('nfe','nfce')
  AND COALESCE(lc116,'') = substr(COALESCE(cst,''),1,4);

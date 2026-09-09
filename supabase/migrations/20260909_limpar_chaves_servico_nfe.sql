-- NF-e/NFC-e nunca usa LC 116 ou NBS. Limpa somente modelos já confirmados,
-- inclusive resíduos históricos que normalizaram CST 41 para "0041".
UPDATE public.movimentos
SET lc116 = NULL,
    nbs = NULL,
    normalizacao_status = 'NAO_APLICAVEL',
    normalizacao_pendencia = '',
    normalizacao_evidencia = ''
WHERE lower(COALESCE(origem,'')) = 'xml'
  AND lower(COALESCE(modelo_documento_fiscal,'')) IN ('nfe','nfce')
  AND (COALESCE(lc116,'') <> '' OR COALESCE(nbs,'') <> '');
